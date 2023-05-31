// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

interface IStakingHOPE {
    function minter() external returns (address);

    function ltToken() external returns (address);

    function controller() external returns (address);

    function votingEscrow() external returns (address);

    function claimableTokens(address addr) external returns (uint256);
}