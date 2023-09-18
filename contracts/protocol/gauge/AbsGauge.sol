// SPDX-License-Identifier: LGPL-3.0

pragma solidity 0.8.17;

import '../libraries/math/WadRayMath.sol';
import {Math} from '../../dependencies/openzeppelin/contracts/Math.sol';
import {Context} from '../../dependencies/openzeppelin/contracts/Context.sol';
import '../../interfaces/ILT.sol';
import '../../interfaces/IGaugeController.sol';
import '../../interfaces/IVotingEscrow.sol';
import '../../interfaces/IMinter.sol';
import '../../interfaces/ILendingGauge.sol';
import '../../interfaces/IAbsGauge.sol';
import '../libraries/types/DataTypes.sol';
import '../libraries/helpers/Errors.sol';

abstract contract AbsGauge is Context, IAbsGauge {
  event UpdateLiquidityLimit(
    address user,
    uint256 originalBalance,
    uint256 originalSupply,
    uint256 workingBalance,
    uint256 workingSupply,
    uint256 votingBalance,
    uint256 votingTotal
  );

  uint256 internal constant _TOKENLESS_PRODUCTION = 40;
  uint256 internal constant _DAY = 86400;
  uint256 internal constant _WEEK = _DAY * 7;

  ILendingGauge public lendingGauge;
  IGaugeController public controller;
  IVotingEscrow public votingEscrow;

  mapping(uint256 => uint256) public historyGaugeRelativeWeight;
  mapping(address => uint256) public workingBalances;
  uint256 public workingSupply;
  mapping(address => uint256) public integrateInvSupplyOf;
  mapping(address => uint256) public integrateCheckpointOf;
  mapping(address => uint256) public integrateFraction; // Mintable Token amount (include minted amount)

  uint256 internal _integrateInvSupply;

  /**
   * @dev Only pool can call functions marked by this modifier.
   */
  modifier onlyLendingGauge() {
    require(_msgSender() == address(lendingGauge), Errors.CALLER_MUST_BE_LENDING_GAUGE);
    _;
  }

  function _setLendingGauge(address _lendingPoolGuageAddr) internal {
    lendingGauge = ILendingGauge(_lendingPoolGuageAddr);
    if (_lendingPoolGuageAddr != address(0)) {
      controller = lendingGauge.controller();
      votingEscrow = lendingGauge.votingEscrow();
    }
  }

  /***
   * @notice Calculate limits which depend on the amount of lp Token per-user.
   *        Effectively it calculates working balances to apply amplification
   *        of LT production by LT
   * @param _addr User address
   * @param _l User's amount of liquidity (LP tokens)
   * @param _L Total amount of liquidity (LP tokens)
   */
  function _updateLiquidityLimit(
    address _addr,
    uint256 _l,
    uint256 _L
  ) internal virtual {
    // To be called after totalSupply is updated
    uint256 _votingBalance = votingEscrow.balanceOfAtTime(_addr, block.timestamp);
    uint256 _votingTotal = votingEscrow.totalSupplyAtTime(block.timestamp);

    uint256 _lim = (_l * _TOKENLESS_PRODUCTION) / 100;
    if (_votingTotal > 0) {
      // 0.4 * _l + 0.6 * _L * balance/total
      _lim += (_L * _votingBalance * (100 - _TOKENLESS_PRODUCTION)) / _votingTotal / 100;
    }

    _lim = Math.min(_l, _lim);
    uint256 _oldBal = workingBalances[_addr];
    workingBalances[_addr] = _lim;
    uint256 _workingSupply = workingSupply + _lim - _oldBal;
    workingSupply = _workingSupply;

    emit UpdateLiquidityLimit(_addr, _l, _L, _lim, _workingSupply, _votingBalance, _votingTotal);
  }

  /***
   * @notice Checkpoint for a user
   * @param _addr User address
   *
   *This function does,
   *1. Calculate Iis for All: Calc and add Iis for every week. Iis only increses over time.
   *2. Calculate Iu for _addr: Calc by (defferece between Iis(last time) and Iis(this time))* LP deposit amount of _addr(include  locking boost)
   *
   * working_supply & working_balance = total_supply & total_balance with  locking boost。
   * Check whitepaper about Iis and Iu.
   */
  function _checkpoint(
    address _addr,
    uint256 _allocation,
    DataTypes.CheckPointParameters memory _st
  ) internal virtual {
    if (block.timestamp > _st.periodTime) {
      uint256 _workingSupply = workingSupply;
      uint256 _prevWeekTime = _st.periodTime;
      uint256 _weekTime = Math.min(((_st.periodTime + _WEEK) / _WEEK) * _WEEK, block.timestamp);
      for (uint256 i; i < 500; i++) {
        uint256 _dt = _weekTime - _prevWeekTime;
        uint256 _preWeekTimeRound = (_prevWeekTime / _WEEK) * _WEEK;
        uint256 _w = historyGaugeRelativeWeight[_preWeekTimeRound];
        if (_w == 0) {
          _w = controller.gaugeRelativeWeight(address(lendingGauge), _preWeekTimeRound);
          historyGaugeRelativeWeight[_preWeekTimeRound] = _w;
        }
        if (_workingSupply > 0) {
          if (_st.prevFutureEpoch >= _prevWeekTime && _st.prevFutureEpoch < _weekTime) {
            _integrateInvSupply += (_st.rate * _w * _allocation * (_st.prevFutureEpoch - _prevWeekTime)) / _workingSupply / WadRayMath.RAY;
            _st.rate = _st.newRate;
            _integrateInvSupply += (_st.rate * _w * _allocation * (_weekTime - _st.prevFutureEpoch)) / _workingSupply / WadRayMath.RAY;
          } else {
            _integrateInvSupply += (_st.rate * _w * _allocation * _dt) / _workingSupply / WadRayMath.RAY;
          }
        }
        if (_weekTime == block.timestamp) {
          break;
        }
        _prevWeekTime = _weekTime;
        _weekTime = Math.min(_weekTime + _WEEK, block.timestamp);
      }
    }
    uint256 _workingBalance = workingBalances[_addr];
    integrateFraction[_addr] += (_workingBalance * (_integrateInvSupply - integrateInvSupplyOf[_addr])) / 10**18;
    integrateInvSupplyOf[_addr] = _integrateInvSupply;
    integrateCheckpointOf[_addr] = block.timestamp;
  }

  function checkpoint(
    address _addr,
    uint256 _allocation,
    DataTypes.CheckPointParameters calldata _st
  ) external onlyLendingGauge {
    _checkpoint(_addr, _allocation, _st);
  }

  function updateLiquidityLimit(address _addr) external onlyLendingGauge {
    _updateLiquidityLimit(_addr, lpBalanceOf(_addr), lpTotalSupply());
  }

  /***
   * @notice The total amount of LP tokens that are currently deposited into the Gauge.
   */
  function lpBalanceOf(address _addr) public virtual view returns (uint256);

  /***
   * @notice The total amount of LP tokens that are currently deposited into the Gauge.
   */
  function lpTotalSupply() public virtual view returns (uint256);
}
