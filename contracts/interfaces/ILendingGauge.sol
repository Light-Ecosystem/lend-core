// SPDX-License-Identifier: LGPL-3.0

pragma solidity 0.8.17;

import './ILT.sol';
import './IGaugeController.sol';
import './IVotingEscrow.sol';
import './IMinter.sol';
import '../protocol/libraries/types/DataTypes.sol';

interface ILendingGauge {
  event AddPhases(DataTypes.Phase[] _phases);

  function initialize(
    address _pool,
    address _minter,
    address _votingEscrow,
    address _underlyingAsset
  ) external;

  function votingEscrow() external view returns (IVotingEscrow);

  function controller() external view returns (IGaugeController);

  function minter() external view returns (IMinter);

  function updateAllocation() external returns (bool);

  function isKilled() external returns (bool);

  function hvCheckpoint(address _addr) external;

  function hvUpdateLiquidityLimit(address _addr) external;
}
