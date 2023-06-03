// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import '../../../dependencies/openzeppelin/contracts/AccessControl.sol';
import '../../../dependencies/openzeppelin/contracts/Ownable.sol';

contract MockAggregator is AccessControl, Ownable {
  bytes32 public constant OPERATOR_ROLE = keccak256('OPERATOR_ROLE');
  int256 private _latestAnswer;

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

  constructor(int256 initialAnswer) {
    _latestAnswer = initialAnswer;
    emit AnswerUpdated(initialAnswer, 0, block.timestamp);
  }

  function latestAnswer() external view returns (int256) {
    return _latestAnswer;
  }

  function setLatestAnswer(int256 answer) external {
    require(_msgSender() == owner() || hasRole(OPERATOR_ROLE, _msgSender()), 'Need operator role');
    _latestAnswer = answer;
    emit AnswerUpdated(answer, 0, block.timestamp);
  }

  function getTokenType() external pure returns (uint256) {
    return 1;
  }

  function decimals() external pure returns (uint8) {
    return 8;
  }

  function isOperator(address _operator) external view returns (bool) {
    return hasRole(OPERATOR_ROLE, _operator);
  }

  function addOperator(address _operator) external onlyOwner {
    _grantRole(OPERATOR_ROLE, _operator);
  }

  function removeOperator(address _operator) external onlyOwner {
    _revokeRole(OPERATOR_ROLE, _operator);
  }
}
