// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

/**
 * @title IDelegationToken
 * @author HopeLend
 * @notice Implements an interface for tokens with delegation COMP/UNI compatible
 */
interface IDelegationToken {
  /**
   * @notice Delegate voting power to a delegatee
   * @param delegatee The address of the delegatee
   */
  function delegate(address delegatee) external;
}
