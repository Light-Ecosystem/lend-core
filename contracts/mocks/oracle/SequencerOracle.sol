// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {Ownable2Step} from '../../dependencies/openzeppelin/contracts/Ownable2Step.sol';
import {ISequencerOracle} from '../../interfaces/ISequencerOracle.sol';

contract SequencerOracle is ISequencerOracle, Ownable2Step {
  bool internal _isDown;
  uint256 internal _timestampGotUp;

  /**
   * @dev Constructor.
   * @param owner The owner address of this contract
   */
  constructor(address owner) {
    _transferOwnership(owner);
  }

  /**
   * @notice Updates the health status of the sequencer.
   * @param isDown True if the sequencer is down, false otherwise
   * @param timestamp The timestamp of last time the sequencer got up
   */
  function setAnswer(bool isDown, uint256 timestamp) external onlyOwner {
    _isDown = isDown;
    _timestampGotUp = timestamp;
  }

  /// @inheritdoc ISequencerOracle
  function latestRoundData()
    external
    view
    override
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    )
  {
    int256 isDown;
    if (_isDown) {
      isDown = 1;
    }
    return (0, isDown, 0, _timestampGotUp, 0);
  }
}
