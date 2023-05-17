// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import {IHopeLendIncentivesController} from '../../interfaces/IHopeLendIncentivesController.sol';

contract MockIncentivesController is IHopeLendIncentivesController {
  function handleAction(
    address,
    uint256,
    uint256
  ) external override {}
}
