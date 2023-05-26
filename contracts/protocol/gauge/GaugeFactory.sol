// SPDX-License-Identifier: LGPL-3.0

pragma solidity 0.8.17;

import '../../dependencies/openzeppelin/contracts/Clones.sol';
import '../../dependencies/openzeppelin/contracts/AccessControl.sol';
import '../../interfaces/ILendingGauge.sol';
import '../../interfaces/IACLManager.sol';
import '../../interfaces/IPool.sol';
import '../../interfaces/IGaugeFactory.sol';
import '../libraries/helpers/Errors.sol';

contract GaugeFactory is AccessControl, IGaugeFactory {
  bytes32 public constant override OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

  IPoolAddressesProvider internal _addressesProvider;

  address public immutable pool;
  address public immutable minter;
  address public immutable votingEscrow;
  address public lendingGaugeImplementation;

  // UnderlyingAsset => LendingGauge
  mapping(address => address) public lendingGauge;
  address[] public allLendingGauges;

  /**
   * @dev Only pool admin can call functions marked by this modifier.
   */
  modifier onlyPoolAdmin() {
    IACLManager aclManager = IACLManager(_addressesProvider.getACLManager());
    require(aclManager.isPoolAdmin(msg.sender), Errors.CALLER_NOT_POOL_ADMIN);
    _;
  }

  /**
   * @dev Only pool admin can call functions marked by this modifier.
   */
  modifier onlyPoolAdminOrOperator() {
    IACLManager aclManager = IACLManager(_addressesProvider.getACLManager());
    require(aclManager.isPoolAdmin(msg.sender), Errors.CALLER_NOT_POOL_ADMIN);
    _;
  }

  constructor(
    address _pool,
    address _lendingGaugeImplementation,
    address _minter,
    address _votingEscrow
  ) {
    require(_pool != address(0), Errors.PARAMETER_ADDRESS_NOT_ZERO);
    require(_lendingGaugeImplementation != address(0), Errors.PARAMETER_ADDRESS_NOT_ZERO);
    require(_minter != address(0), Errors.PARAMETER_ADDRESS_NOT_ZERO);
    require(_votingEscrow != address(0), Errors.PARAMETER_ADDRESS_NOT_ZERO);
    pool = _pool;
    lendingGaugeImplementation = _lendingGaugeImplementation;
    minter = _minter;
    votingEscrow = _votingEscrow;
    _addressesProvider = IPool(_pool).ADDRESSES_PROVIDER();
  }

  function createLendingGauge(address _underlyingAsset)
    external
    onlyRole(OPERATOR_ROLE)
    returns (address lendingGaugeAddress)
  {
    bytes32 salt = keccak256(abi.encodePacked(_underlyingAsset));
    lendingGaugeAddress = Clones.cloneDeterministic(lendingGaugeImplementation, salt);
    ILendingGauge(lendingGaugeAddress).initialize(
      pool,
      minter,
      votingEscrow,
      _underlyingAsset
    );
    lendingGauge[_underlyingAsset] = lendingGaugeAddress;
    allLendingGauges.push(lendingGaugeAddress);
    emit LendingGaugeCreated(_underlyingAsset, lendingGaugeAddress, allLendingGauges.length);
  }

  function allLendingGaugesLength() external view returns (uint256) {
    return allLendingGauges.length;
  }

  function setLendingGaugeImplementation(address _gaugeAddress) external onlyPoolAdmin {
    require(_gaugeAddress != address(0), 'PARAMETER_ADDRESS_NOT_ZERO');
    lendingGaugeImplementation = _gaugeAddress;
    emit SetLendingGaugeImplementation(_gaugeAddress);
  }

  function isOperator(address operator) external view override returns (bool) {
    return hasRole(OPERATOR_ROLE, operator);
  }

  function addOperator(address operator) external override onlyPoolAdmin {
    _grantRole(OPERATOR_ROLE, operator);
  }

  function removeOperator(address operator) external override onlyPoolAdmin {
    _revokeRole(OPERATOR_ROLE, operator);
  }
}
