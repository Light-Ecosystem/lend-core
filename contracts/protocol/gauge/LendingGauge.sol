// SPDX-License-Identifier: LGPL-3.0

pragma solidity 0.8.17;

import '../libraries/math/WadRayMath.sol';
import '../../interfaces/ILT.sol';
import '../../interfaces/IGaugeController.sol';
import '../../interfaces/IVotingEscrow.sol';
import '../../interfaces/IMinter.sol';
import '../../dependencies/openzeppelin/contracts/IERC20Detailed.sol';
import '../../interfaces/IHTokenRewards.sol';
import '../../interfaces/IVariableDebtTokenRewards.sol';
import '../../interfaces/IACLManager.sol';
import '../../interfaces/IPool.sol';
import '../../interfaces/ILendingGauge.sol';
import '../../dependencies/openzeppelin/upgradeability/Initializable.sol';
import '../../dependencies/openzeppelin/contracts/SafeCast.sol';
import '../libraries/types/DataTypes.sol';
import '../libraries/helpers/Errors.sol';

contract LendingGauge is ILendingGauge, Initializable {
  event UpdateStableDebtPercentage(uint256 time, uint256 oldPercentage, uint256 newPercentage);
  event UpdateAllocation(uint256 time, uint256 allocation);

  using WadRayMath for uint256;
  using SafeCast for uint256;
  using SafeCast for int256;

  /**
   * @dev Only pool admin can call functions marked by this modifier.
   */
  modifier onlyPoolAdmin() {
    IACLManager aclManager = IACLManager(_addressesProvider.getACLManager());
    require(aclManager.isPoolAdmin(msg.sender), Errors.CALLER_NOT_POOL_ADMIN);
    _;
  }

  uint256 internal constant _DAY = 86400;
  uint256 internal constant _WEEK = _DAY * 7;

  IPoolAddressesProvider internal _addressesProvider;
  IPool public POOL;
  address public hToken;
  address public variableDebtToken;
  address public stableDebtToken;
  address public underlyingAsset;

  IMinter public minter;
  ILT public ltToken;
  IVotingEscrow public votingEscrow;
  IGaugeController public controller;

  address public factory;
  string public name;
  bool public isKilled;

  uint256 public period;
  mapping(uint256 => uint256) public periodTimestamp;
  uint256 public inflationRate;
  uint256 public futureEpochTime;

  mapping(uint256 => bool) public checkedGauge;
  DataTypes.Phase[] public phases;
  uint256 public borrowAllocation;

  constructor() {
    factory = address(0xdead);
  }

  function initialize(
    address _pool,
    address _minter,
    address _votingEscrow,
    address _underlyingAsset
  ) public override {
    require(_pool != address(0), Errors.PARAMETER_ADDRESS_NOT_ZERO);
    require(_minter != address(0), Errors.PARAMETER_ADDRESS_NOT_ZERO);
    require(_votingEscrow != address(0), Errors.PARAMETER_ADDRESS_NOT_ZERO);
    require(_underlyingAsset != address(0), Errors.PARAMETER_ADDRESS_NOT_ZERO);
    require(factory == address(0), 'GP002');
    factory = msg.sender;
    POOL = IPool(_pool);
    _addressesProvider = POOL.ADDRESSES_PROVIDER();
    minter = IMinter(_minter);
    ltToken = ILT(minter.token());
    votingEscrow = IVotingEscrow(_votingEscrow);
    controller = IGaugeController(minter.controller());
    DataTypes.ReserveData memory reserve = POOL.getReserveData(_underlyingAsset);
    hToken = reserve.hTokenAddress;
    variableDebtToken = reserve.variableDebtTokenAddress;
    stableDebtToken = reserve.stableDebtTokenAddress;
    underlyingAsset = _underlyingAsset;
    name = string.concat(IERC20Detailed(_underlyingAsset).symbol(), ' LendingGauge');
    periodTimestamp[0] = block.timestamp;
    inflationRate = ltToken.rate();
    futureEpochTime = ltToken.futureEpochTimeWrite();
  }

  function _addPhase(DataTypes.Phase memory _phase) internal {
    require(_phase.endPercentage > _phase.startPercentage, Errors.LENDING_GAUGE_PERCENTAGE_NOT_MATCH);
    require(
      phases.length == 0 || _phase.startPercentage == phases[phases.length - 1].endPercentage,
      Errors.LENDING_GAUGE_PERCENTAGE_NOT_MATCH
    );
    phases.push(DataTypes.Phase(_phase.startPercentage, _phase.endPercentage, _phase.k, _phase.b));
  }

  /**
   * Add parameters for calculating fund utilization rate and allocation ratio
   */
  function addPhases(DataTypes.Phase[] calldata _phases) external onlyPoolAdmin {
    require(_phases.length >= 4 && _phases.length <= 10, Errors.INVALID_PHASES_LENGTH);
    delete phases;
    for (uint256 i = 0; i < _phases.length; i++) {
      _addPhase(_phases[i]);
    }
  }

  /**
   * Update debt token allocation ratio based on fund utilization rate
   */
  function updateAllocation() external override returns (bool) {
    uint256 stableDebtTokenTotalSupply = IERC20(stableDebtToken).totalSupply();
    uint256 variableDebtTokenTotalSupply = IERC20(variableDebtToken).totalSupply();
    uint256 totalDebt = stableDebtTokenTotalSupply + variableDebtTokenTotalSupply;
    if (totalDebt == 0) {
      borrowAllocation = 0;
      return true;
    }
    uint256 availableLiquidity = IERC20(underlyingAsset).balanceOf(hToken);
    uint256 availableLiquidityPlusDebt = availableLiquidity + totalDebt;
    if (availableLiquidityPlusDebt == 0) {
      borrowAllocation = 0;
      return false;
    }
    borrowAllocation = _getAllocationByUtilizationRate(totalDebt.rayDiv(availableLiquidityPlusDebt));
    return true;
  }

  /**
   * Reserve incentive aggregation
   */
  function integrateFraction(address _addr) public view returns (uint256) {
    return IHTokenRewards(hToken).integrateFraction(_addr) + IVariableDebtTokenRewards(variableDebtToken).integrateFraction(_addr);
  }

  /**
   * Reserve aggregation checkpoint
   */
  function hvCheckpoint(address _addr) public override {
    DataTypes.CheckPointParameters memory _st;
    _st.period = period;
    _st.periodTime = periodTimestamp[_st.period];
    _st.rate = inflationRate;
    _st.newRate = _st.rate;
    _st.prevFutureEpoch = futureEpochTime;
    if (_st.prevFutureEpoch <= block.timestamp) {
      futureEpochTime = ltToken.futureEpochTimeWrite();
      _st.newRate = ltToken.rate();
      inflationRate = _st.newRate;
    }
    uint256 _weekTime = (block.timestamp / _WEEK) * _WEEK;
    if (!checkedGauge[_weekTime]) {
      checkedGauge[_weekTime] = true;
      controller.checkpointGauge(address(this));
    }
    if (isKilled) {
      // Stop distributing inflation as soon as killed
      _st.rate = 0;
    }
    if (IHTokenRewards(hToken).totalSupply() != 0) {
      IHTokenRewards(hToken).checkpoint(_addr, _calRelativeWeightByAllocation(hToken), _st);
    }
    if (IVariableDebtTokenRewards(variableDebtToken).totalSupply() != 0) {
      IVariableDebtTokenRewards(variableDebtToken).checkpoint(_addr, _calRelativeWeightByAllocation(variableDebtToken), _st);
    }
    _st.period += 1;
    period = _st.period;
    periodTimestamp[_st.period] = block.timestamp;
  }

  /**
   * Reserve aggregation updateLiquidityLimit
   */
  function hvUpdateLiquidityLimit(address _addr) external override {
    if (IHTokenRewards(hToken).totalSupply() != 0) {
      IHTokenRewards(hToken).updateLiquidityLimit(_addr);
    }
    if (IVariableDebtTokenRewards(variableDebtToken).totalSupply() != 0) {
      IVariableDebtTokenRewards(variableDebtToken).updateLiquidityLimit(_addr);
    }
  }

  /***
   * @notice Record a checkpoint for `_addr`
   * @param _addr User address
   * @return bool success
   */
  function userCheckpoint(address _addr) external returns (bool) {
    require((msg.sender == _addr) || (msg.sender == address(minter)), 'GP000');
    _userCheckpoint(_addr);
    return true;
  }

  /***
   * @notice Get the number of claimable tokens per user
   * @dev This function should be manually changed to "view" in the ABI
   * @return uint256 number of claimable tokens per user
   */
  function claimableTokens(address _addr) external returns (uint256) {
    hvCheckpoint(_addr);
    return (integrateFraction(_addr) - minter.minted(_addr, address(this)));
  }

  /***
   * @notice Set the killed status for this contract
   * @dev When killed, the gauge always yields a rate of 0 and so cannot mint LT
   * @param _is_killed Killed status to set
   */
  function setKilled(bool _isKilled) external onlyPoolAdmin {
    isKilled = _isKilled;
  }

  /***
   * @notice Kick `_addr` for abusing their boost
   * @dev Only if either they had another voting event, or their voting escrow lock expired
   * @param _addr Address to kick
   */
  function kick(address _addr) external {
    uint256 _hTokenLast = IHTokenRewards(hToken).integrateCheckpointOf(_addr);
    uint256 _variableDebtTokenLast = IVariableDebtTokenRewards(variableDebtToken).integrateCheckpointOf(_addr);
    uint256 _tVe = votingEscrow.userPointHistoryTs(_addr, votingEscrow.userPointEpoch(_addr));
    uint256 _hTokenBalance = IHTokenRewards(hToken).lpBalanceOf(_addr);
    uint256 _variableDebtTokenBalance = IHTokenRewards(hToken).lpBalanceOf(_addr);

    require(votingEscrow.balanceOfAtTime(_addr, block.timestamp) == 0 || _tVe > _hTokenLast || _tVe > _variableDebtTokenLast, 'GP001');
    require(
      IHTokenRewards(hToken).workingBalances(_addr) > (_hTokenBalance * 40) / 100 ||
        IVariableDebtTokenRewards(variableDebtToken).workingBalances(_addr) > (_variableDebtTokenBalance * 40) / 100,
      'GP001'
    );

    _userCheckpoint(_addr);
  }

  /**
   * Calculate the allocation ratio between HToken and DebtToken
   * @param _tokenAddr hToken、vdToken address
   */
  function _calRelativeWeightByAllocation(address _tokenAddr) private view returns (uint256) {
    return _tokenAddr == hToken ? WadRayMath.RAY - borrowAllocation : borrowAllocation;
  }

  /**
   * Calculate the debt token allocation ratio based on fund utilization rate
   * @dev borrowAllocation = kx + b. k = (y2 - y1) / (x2 - x1). b = y1 - m * x1.
   * @param _utilizationRate Utilization rate
   */
  function _getAllocationByUtilizationRate(uint256 _utilizationRate) internal view returns (uint256) {
    require(phases.length > 0, Errors.PHASES_NOT_DEFINED);
    if (_utilizationRate == 0) {
      return 0;
    }
    for (uint256 i = 0; i < phases.length; i++) {
      if (_utilizationRate > phases[i].startPercentage && _utilizationRate <= phases[i].endPercentage) {
        int256 _borrowAllocation = (phases[i].k * _utilizationRate.toInt256()) / WadRayMath.RAY.toInt256() + phases[i].b.toInt256();
        require(_borrowAllocation >= 0, Errors.MUST_BE_NON_NEGATIVE);
        return _borrowAllocation.toUint256();
      }
    }
    return 0;
  }

  /***
   * @notice Record a checkpoint for `_addr`
   * @param _addr User address
   * @return bool success
   */
  function _userCheckpoint(address _addr) internal {
    DataTypes.CheckPointParameters memory _st;
    _st.period = period;
    _st.periodTime = periodTimestamp[_st.period];
    _st.rate = inflationRate;
    _st.newRate = _st.rate;
    _st.prevFutureEpoch = futureEpochTime;
    if (_st.prevFutureEpoch <= block.timestamp) {
      futureEpochTime = ltToken.futureEpochTimeWrite();
      _st.newRate = ltToken.rate();
      inflationRate = _st.newRate;
    }
    uint256 _weekTime = (block.timestamp / _WEEK) * _WEEK;
    if (!checkedGauge[_weekTime]) {
      checkedGauge[_weekTime] = true;
      controller.checkpointGauge(address(this));
    }
    if (isKilled) {
      // Stop distributing inflation as soon as killed
      _st.rate = 0;
    }
    if (IHTokenRewards(hToken).totalSupply() != 0) {
      IHTokenRewards(hToken).checkpoint(_addr, _calRelativeWeightByAllocation(hToken), _st);
      IHTokenRewards(hToken).updateLiquidityLimit(_addr);
    }
    if (IVariableDebtTokenRewards(variableDebtToken).totalSupply() != 0) {
      IVariableDebtTokenRewards(variableDebtToken).checkpoint(_addr, _calRelativeWeightByAllocation(variableDebtToken), _st);
      IVariableDebtTokenRewards(variableDebtToken).updateLiquidityLimit(_addr);
    }
    _st.period += 1;
    period = _st.period;
    periodTimestamp[_st.period] = block.timestamp;
  }
}
