// SPDX-License-Identifier: LGPL-3.0
pragma solidity 0.8.17;

import "../../dependencies/openzeppelin/contracts/Pausable.sol";
import "../../dependencies/openzeppelin/contracts/Ownable.sol";
import "../../dependencies/openzeppelin/contracts/AccessControl.sol";
import "../../dependencies/openzeppelin/contracts/IERC20.sol";

interface IBurner {
    function burn(address to, IERC20 token, uint amount, uint amountOutMin) external;
}

interface IBurnerManager {
    function burners(address token) external returns (IBurner burner);
}

contract LendingFeeToVault is Ownable, Pausable, AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("Operator_Role");

    address public immutable burnerManager;
    address public immutable underlyingBurner;

    constructor(address _burnerManager, address _underlyingBurner) {
        require(address(_burnerManager) != address(0), "Invalid Address");
        require(_underlyingBurner != address(0), "Invalid Address");

        burnerManager = _burnerManager;
        underlyingBurner = _underlyingBurner;
    }

    function _burn(IERC20 token, uint amountIn, uint amountOutMin) internal {
        uint256 balanceOfThis = token.balanceOf(address(this));
        require(amountIn > 0 && amountIn <= balanceOfThis);

        // user choose to not burn token if not profitable
        IBurner burner = IBurnerManager(burnerManager).burners(address(token));
        require(burner != IBurner(address(0)), "Burner does not exist");
        IERC20(token).approve(address(burner), amountIn);
        burner.burn(underlyingBurner, token, amountIn, amountOutMin);
    }

    function burn(IERC20 token, uint amountIn, uint amountOutMin) external whenNotPaused onlyRole(OPERATOR_ROLE) {
        _burn(token, amountIn, amountOutMin);
    }

    function burnMany(IERC20[] calldata tokens, uint[] calldata amountIns, uint[] calldata amountOutMins) external whenNotPaused onlyRole(OPERATOR_ROLE) {
        for (uint i = 0; i < tokens.length && i < 128; i++) {
            _burn(tokens[i], amountIns[i], amountOutMins[i]);
        }
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function isOperator(address _operator) external view returns (bool) {
        return hasRole(OPERATOR_ROLE, _operator);
    }

    function addOperator(address account) public onlyOwner {
        _grantRole(OPERATOR_ROLE, account);
    }

    function removeOperator(address account) public onlyOwner {
        _revokeRole(OPERATOR_ROLE, account);
    }
}
