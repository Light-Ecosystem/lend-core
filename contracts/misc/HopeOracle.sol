// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {AggregatorInterface} from '../dependencies/chainlink/AggregatorInterface.sol';
import {Errors} from '../protocol/libraries/helpers/Errors.sol';
import {IACLManager} from '../interfaces/IACLManager.sol';
import {IPoolAddressesProvider} from '../interfaces/IPoolAddressesProvider.sol';
import {IPriceOracleGetter} from '../interfaces/IPriceOracleGetter.sol';
import {IHopeOracle} from '../interfaces/IHopeOracle.sol';
import "hardhat/console.sol";

/**
 * @title HopeOracle
 * @author Hope
 * @notice Contract to get asset prices, manage price sources and update the fallback oracle
 * - Use of Chainlink Aggregators as first source of price
 * - If the returned price by a Chainlink aggregator is <= 0, the call is forwarded to a fallback oracle
 * - Owned by the Hope governance
 */
contract HopeOracle is IHopeOracle {
  IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;

  struct PriceData{
    AggregatorInterface source;
    bool failoverActive;
  }

  // Map of asset price sources (asset => priceSource)
  mapping(address => PriceData) private assetsPriceDatas;

  IPriceOracleGetter private _fallbackOracle;
  address public immutable override BASE_CURRENCY;
  uint256 public immutable override BASE_CURRENCY_UNIT;

  /**
   * @dev Only asset listing or pool admin can call functions marked by this modifier.
   */
  modifier onlyAssetListingOrPoolAdmins() {
    _onlyAssetListingOrPoolAdmins();
    _;
  }

  /**
   * @notice Constructor
   * @param provider The address of the new PoolAddressesProvider
   * @param assets The addresses of the assets
   * @param sources The address of the source of each asset
   * @param fallbackOracle The address of the fallback oracle to use if the data of an
   *        aggregator is not consistent
   * @param baseCurrency The base currency used for the price quotes. If USD is used, base currency is 0x0
   * @param baseCurrencyUnit The unit of the base currency
   */
  constructor(
    IPoolAddressesProvider provider,
    address[] memory assets,
    address[] memory sources,
    address fallbackOracle,
    address baseCurrency,
    uint256 baseCurrencyUnit
  ) {
    ADDRESSES_PROVIDER = provider;
    _setFallbackOracle(fallbackOracle);
    _setAssetsSources(assets, sources);
    BASE_CURRENCY = baseCurrency;
    BASE_CURRENCY_UNIT = baseCurrencyUnit;
    emit BaseCurrencySet(baseCurrency, baseCurrencyUnit);
  }

  /// @inheritdoc IHopeOracle
  function setAssetSources(address[] calldata assets, address[] calldata sources)
    external
    override
    onlyAssetListingOrPoolAdmins
  {
    _setAssetsSources(assets, sources);
  }

  /// @inheritdoc IHopeOracle
  function setFallbackOracle(address fallbackOracle)
    external
    override
    onlyAssetListingOrPoolAdmins
  {
    _setFallbackOracle(fallbackOracle);
  }

  /**
  * @notice Activate the failover for an asset
  * @param asset The address of the asset
  */
  function activateFailover(address asset) 
    external 
    override 
    onlyAssetListingOrPoolAdmins 
  {
    _activateFailover(asset);
  }

  /**
  * @notice Deactivate the failover for an asset
  * @param asset The address of the asset
  */
  function deactivateFailover(address asset)
    external
    override 
    onlyAssetListingOrPoolAdmins 
  {
    _deactivateFailover(asset);
  }

  /**
   * @notice Internal function to set the sources for each asset
   * @param assets The addresses of the assets
   * @param sources The address of the source of each asset
   */
  function _setAssetsSources(address[] memory assets, address[] memory sources) internal {
    require(assets.length == sources.length, Errors.INCONSISTENT_PARAMS_LENGTH);
    for (uint256 i = 0; i < assets.length; i++) {
      assetsPriceDatas[assets[i]] = PriceData({source: AggregatorInterface(sources[i]), failoverActive: false});
      emit AssetSourceUpdated(assets[i], sources[i]);
    }
  }

  /**
   * @notice Internal function to set the fallback oracle
   * @param fallbackOracle The address of the fallback oracle
   */
  function _setFallbackOracle(address fallbackOracle) internal {
    _fallbackOracle = IPriceOracleGetter(fallbackOracle);
    emit FallbackOracleUpdated(fallbackOracle);
  }

  /**
   * @notice Internal function to activate the failover for an asset
   * @param asset The address of the asset
   */
  function _activateFailover(address asset) internal {
    PriceData storage priceData = assetsPriceDatas[asset];
    require(!priceData.failoverActive, Errors.FAILOVER_ALREADY_ACTIVE);
    priceData.failoverActive = true;
    emit FailoverActivated(asset);
  }

  /**
   * @notice Internal function to deactivate the failover for an asset
   * @param asset The address of the asset
   */
  function _deactivateFailover(address asset) internal {
    PriceData storage priceData = assetsPriceDatas[asset];
    require(priceData.failoverActive, Errors.FAILOVER_ALREADY_DEACTIVATED);
    priceData.failoverActive = false;
    emit FailoverDeactivated(asset);
  }

  /// @inheritdoc IPriceOracleGetter
  function getAssetPrice(address asset) public view override returns (uint256) {
    PriceData storage priceData = assetsPriceDatas[asset];

    if (asset == BASE_CURRENCY) {
      return BASE_CURRENCY_UNIT;
    } else if (address(priceData.source) == address(0)) {
      return _fallbackOracle.getAssetPrice(asset);
    } else if (priceData.failoverActive) {
      return _fallbackOracle.getAssetPrice(asset);
    } else {
      int256 price = priceData.source.latestAnswer();
      if (price > 0) {
        return uint256(price);
      } else {
        return _fallbackOracle.getAssetPrice(asset);
      }
    }
  }

  /// @inheritdoc IHopeOracle
  function getAssetsPrices(address[] calldata assets)
    external
    view
    override
    returns (uint256[] memory)
  {
    uint256[] memory prices = new uint256[](assets.length);
    for (uint256 i = 0; i < assets.length; i++) {
      prices[i] = getAssetPrice(assets[i]);
    }
    return prices;
  }

  /// @inheritdoc IHopeOracle
  function getSourceOfAsset(address asset) external view override returns (address) {
    return address(assetsPriceDatas[asset].source);
  }

  /// @inheritdoc IHopeOracle
  function getFailoverStatusOfAsset(address asset) external view override returns (bool) {
    return assetsPriceDatas[asset].failoverActive;
  }

  /// @inheritdoc IHopeOracle
  function getFallbackOracle() external view returns (address) {
    return address(_fallbackOracle);
  }

  function _onlyAssetListingOrPoolAdmins() internal view {
    IACLManager aclManager = IACLManager(ADDRESSES_PROVIDER.getACLManager());
    require(
      aclManager.isAssetListingAdmin(msg.sender) || aclManager.isPoolAdmin(msg.sender),
      Errors.CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN
    );
  }
}
