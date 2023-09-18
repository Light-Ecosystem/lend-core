// SPDX-License-Identifier: LGPL-3.0

pragma solidity 0.8.17;

interface IL2LendingGauge {
  function inflationRate(uint256 _weekTime) external view returns (uint256);
}
