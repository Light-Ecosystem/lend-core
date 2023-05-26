// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

interface IGaugeFactory {
  event LendingGaugeCreated(address indexed assset, address indexed lendingGauge, uint256);
  event SetLendingGaugeImplementation(address);

  function OPERATOR_ROLE() external view returns (bytes32);

  function isOperator(address operator) external view returns (bool);

  function addOperator(address operator) external;

  function removeOperator(address operator) external;
}
