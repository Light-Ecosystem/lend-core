// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {IERC20} from '../../dependencies/openzeppelin/contracts/IERC20.sol';
import {GPv2SafeERC20} from '../../dependencies/gnosis/contracts/GPv2SafeERC20.sol';
import {SafeCast} from '../../dependencies/openzeppelin/contracts/SafeCast.sol';
import {VersionedInitializable} from '../libraries/hopelend-upgradeability/VersionedInitializable.sol';
import {Errors} from '../libraries/helpers/Errors.sol';
import {WadRayMath} from '../libraries/math/WadRayMath.sol';
import {IPool} from '../../interfaces/IPool.sol';
import {IHToken} from '../../interfaces/IHToken.sol';
import {IHopeLendIncentivesController} from '../../interfaces/IHopeLendIncentivesController.sol';
import {IInitializableHToken} from '../../interfaces/IInitializableHToken.sol';
import {ScaledBalanceTokenBase} from './base/ScaledBalanceTokenBase.sol';
import {IncentivizedERC20} from './base/IncentivizedERC20.sol';
import {EIP712Base} from './base/EIP712Base.sol';

/**
 * @title HopeLend ERC20 HToken
 * @author HopeLend
 * @notice Implementation of the interest bearing token for the HopeLend protocol
 */
contract HToken is VersionedInitializable, ScaledBalanceTokenBase, EIP712Base, IHToken {
  using WadRayMath for uint256;
  using SafeCast for uint256;
  using GPv2SafeERC20 for IERC20;

  bytes32 public constant PERMIT_TYPEHASH =
    keccak256('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)');

  uint256 public constant HTOKEN_REVISION = 0x1;

  address internal _treasury;
  address internal _underlyingAsset;

  /// @inheritdoc VersionedInitializable
  function getRevision() internal pure virtual override returns (uint256) {
    return HTOKEN_REVISION;
  }

  /**
   * @dev Constructor.
   * @param pool The address of the Pool contract
   */
  constructor(IPool pool)
    ScaledBalanceTokenBase(pool, 'HTOKEN_IMPL', 'HTOKEN_IMPL', 0)
    EIP712Base()
  {
    // Intentionally left blank
  }

  /// @inheritdoc IInitializableHToken
  function initialize(
    IPool initializingPool,
    address treasury,
    address underlyingAsset,
    IHopeLendIncentivesController incentivesController,
    uint8 hTokenDecimals,
    string calldata hTokenName,
    string calldata hTokenSymbol,
    bytes calldata params
  ) public virtual override initializer {
    require(initializingPool == POOL, Errors.POOL_ADDRESSES_DO_NOT_MATCH);
    _setName(hTokenName);
    _setSymbol(hTokenSymbol);
    _setDecimals(hTokenDecimals);

    _treasury = treasury;
    _underlyingAsset = underlyingAsset;
    _incentivesController = incentivesController;

    _domainSeparator = _calculateDomainSeparator();

    emit Initialized(
      underlyingAsset,
      address(POOL),
      treasury,
      address(incentivesController),
      hTokenDecimals,
      hTokenName,
      hTokenSymbol,
      params
    );
  }

  /// @inheritdoc IHToken
  function mint(
    address caller,
    address onBehalfOf,
    uint256 amount,
    uint256 index
  ) external virtual override onlyPool returns (bool) {
    return _mintScaled(caller, onBehalfOf, amount, index);
  }

  /// @inheritdoc IHToken
  function burn(
    address from,
    address receiverOfUnderlying,
    uint256 amount,
    uint256 index
  ) external virtual override onlyPool {
    _burnScaled(from, receiverOfUnderlying, amount, index);
    if (receiverOfUnderlying != address(this)) {
      IERC20(_underlyingAsset).safeTransfer(receiverOfUnderlying, amount);
    }
  }

  /// @inheritdoc IHToken
  function mintToTreasury(uint256 amount, uint256 index) external virtual override onlyPool {
    if (amount == 0) {
      return;
    }
    _mintScaled(address(POOL), _treasury, amount, index);
  }

  /// @inheritdoc IHToken
  function transferOnLiquidation(
    address from,
    address to,
    uint256 value
  ) external virtual override onlyPool {
    // Being a normal transfer, the Transfer() and BalanceTransfer() are emitted
    // so no need to emit a specific event here
    _transfer(from, to, value, false);
  }

  /// @inheritdoc IERC20
  function balanceOf(address user)
    public
    view
    virtual
    override(IncentivizedERC20, IERC20)
    returns (uint256)
  {
    return super.balanceOf(user).rayMul(POOL.getReserveNormalizedIncome(_underlyingAsset));
  }

  /// @inheritdoc IERC20
  function totalSupply() public view virtual override(IncentivizedERC20, IERC20) returns (uint256) {
    uint256 currentSupplyScaled = super.totalSupply();

    if (currentSupplyScaled == 0) {
      return 0;
    }

    return currentSupplyScaled.rayMul(POOL.getReserveNormalizedIncome(_underlyingAsset));
  }

  /// @inheritdoc IHToken
  function RESERVE_TREASURY_ADDRESS() external view override returns (address) {
    return _treasury;
  }

  /// @inheritdoc IHToken
  function UNDERLYING_ASSET_ADDRESS() external view override returns (address) {
    return _underlyingAsset;
  }

  /// @inheritdoc IHToken
  function transferUnderlyingTo(address target, uint256 amount) external virtual override onlyPool {
    IERC20(_underlyingAsset).safeTransfer(target, amount);
  }

  /// @inheritdoc IHToken
  function handleRepayment(
    address user,
    address onBehalfOf,
    uint256 amount
  ) external virtual override onlyPool {
    // Intentionally left blank
  }

  /// @inheritdoc IHToken
  function permit(
    address owner,
    address spender,
    uint256 value,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external override {
    require(owner != address(0), Errors.ZERO_ADDRESS_NOT_VALID);
    //solium-disable-next-line
    require(block.timestamp <= deadline, Errors.INVALID_EXPIRATION);
    uint256 currentValidNonce = _nonces[owner];
    bytes32 digest = keccak256(
      abi.encodePacked(
        '\x19\x01',
        DOMAIN_SEPARATOR(),
        keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, currentValidNonce, deadline))
      )
    );
    require(owner == ecrecover(digest, v, r, s), Errors.INVALID_SIGNATURE);
    _nonces[owner] = currentValidNonce + 1;
    _approve(owner, spender, value);
  }

  /**
   * @notice Transfers the hTokens between two users. Validates the transfer
   * (ie checks for valid HF after the transfer) if required
   * @param from The source address
   * @param to The destination address
   * @param amount The amount getting transferred
   * @param validate True if the transfer needs to be validated, false otherwise
   */
  function _transfer(
    address from,
    address to,
    uint256 amount,
    bool validate
  ) internal virtual {
    address underlyingAsset = _underlyingAsset;

    uint256 index = POOL.getReserveNormalizedIncome(underlyingAsset);

    uint256 fromBalanceBefore = super.balanceOf(from).rayMul(index);
    uint256 toBalanceBefore = super.balanceOf(to).rayMul(index);

    super._transfer(from, to, amount, index);

    if (validate) {
      POOL.finalizeTransfer(underlyingAsset, from, to, amount, fromBalanceBefore, toBalanceBefore);
    }

    emit BalanceTransfer(from, to, amount.rayDiv(index), index);
  }

  /**
   * @notice Overrides the parent _transfer to force validated transfer() and transferFrom()
   * @param from The source address
   * @param to The destination address
   * @param amount The amount getting transferred
   */
  function _transfer(
    address from,
    address to,
    uint128 amount
  ) internal virtual override {
    _transfer(from, to, amount, true);
  }

  /**
   * @dev Overrides the base function to fully implement IHToken
   * @dev see `EIP712Base.DOMAIN_SEPARATOR()` for more detailed documentation
   */
  function DOMAIN_SEPARATOR() public view override(IHToken, EIP712Base) returns (bytes32) {
    return super.DOMAIN_SEPARATOR();
  }

  /**
   * @dev Overrides the base function to fully implement IHToken
   * @dev see `EIP712Base.nonces()` for more detailed documentation
   */
  function nonces(address owner) public view override(IHToken, EIP712Base) returns (uint256) {
    return super.nonces(owner);
  }

  /// @inheritdoc EIP712Base
  function _EIP712BaseId() internal view override returns (string memory) {
    return name();
  }

  /// @inheritdoc IHToken
  function rescueTokens(
    address token,
    address to,
    uint256 amount
  ) external override onlyPoolAdmin {
    require(token != _underlyingAsset, Errors.UNDERLYING_CANNOT_BE_RESCUED);
    IERC20(token).safeTransfer(to, amount);
  }

  function lpBalanceOf(address _addr) public view override returns (uint256) {
    return balanceOf(_addr);
  }

  function lpTotalSupply() public view override returns (uint256) {
    return totalSupply();
  }
}
