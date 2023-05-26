// SPDX-License-Identifier: LGPL-3.0

pragma solidity 0.8.17;
import '../protocol/libraries/types/DataTypes.sol';

interface IStableDebtTokenRewards {
  function setLendingGauge(address _lendingGauge) external;

  function integrateFraction(address _addr) external view returns (uint256);

  function balanceOf(address _addr) external view returns (uint256);

  function totalSupply() external view returns (uint256);

  function checkpoint(
    address _addr,
    uint256 _allocation,
    DataTypes.CheckPointParameters calldata _st
  ) external;

  function updateLiquidityLimit(address _addr) external;

  function workingBalances(address _addr) external view returns (uint256);

  function integrateCheckpointOf(address _addr) external view returns (uint256);

  function lpBalanceOf(address _addr) external view returns (uint256);
}
