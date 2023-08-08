# HopeLend Protocol

This repository contains the smart contracts source code and markets configuration for HopeLend Protocol. The repository uses Docker Compose and Hardhat as development environment for compilation, testing and deployment tasks.

## What is HopeLend?

HopeLend is a decentralized non-custodial liquidity markets protocol where users can participate as suppliers or borrowers. Suppliers provide liquidity to the market to earn a passive income, while borrowers are able to borrow in an overcollateralized (perpetually) or undercollateralized (one-block liquidity) fashion.

## Documentation

See the link to know more about HopeLend

- (https://hope-money.gitbook.io/hopelend-wip/F9bSJmvfdpzwPh7rn1U5/)

## Audits

You can find all audit reports under the audits folder

V1.0 - July 2023

- [PeckShield](./audits/30-07-2023_PeckShield_HopeLendV1.pdf)
- [Beosin](./audits/19-07-2023_Beosin_Hope-oracle.pdf)
- [Beosin](./audits/19-07-2023_Beosin_HopeLendV1_Core.pdf)
- [Beosin](./audits/19-07-2023_Beosin_HopeLendV1_Periphery.pdf)
- [MetaTrust](./audits/29-07-2023_MetaTrust_Hope-oracle.pdf)
- [MetaTrust](./audits/29-07-2023_MetaTrust_HopeLendV1_Core.pdf)
- [MetaTrust](./audits/29-07-2023_MetaTrust_HopeLendV1_Periphery.pdf)

## Connect with the community

You can join the [Discord](https://discord.gg/hopemoneyofficial) to ask questions about the protocol or talk about HopeLend with other peers.

## Getting Started

You can install `@hopelend/core` as an NPM package in your Hardhat or Truffle project to import the contracts and interfaces:

`npm install @hopelend/core`

Import at Solidity files:

```
import {IPool} from "@hopelend/core/contracts/interfaces/IPool.sol";

contract Misc {

  function supply(address pool, address token, address user, uint256 amount) public {
    IPool(pool).supply(token, amount, user, 0);
    {...}
  }
}
```

The JSON artifacts with the ABI and Bytecode are also included in the bundled NPM package at `artifacts/` directory.

Import JSON file via Node JS `require`:

```
const PoolArtifact = require('@hopelend/core/artifacts/contracts/protocol/pool/Pool.sol/Pool.json');

// Log the ABI into console
console.log(PoolArtifact.abi)
```

## Setup

The repository uses Docker Compose to manage sensitive keys and load the configuration. Prior to any action like test or deploy, you must run `docker-compose up` to start the `contracts-env` container, and then connect to the container console via `docker-compose exec contracts-env bash`.

Follow the next steps to setup the repository:

- Install `docker` and `docker-compose`
- Create an environment file named `.env` and fill the next environment variables

```
# Add Alchemy or Infura provider keys, alchemy takes preference at the config level
ALCHEMY_KEY=""
INFURA_KEY=""


# Optional, if you plan to use Tenderly scripts
TENDERLY_PROJECT=""
TENDERLY_USERNAME=""

```

## Test

You can run the full test suite with the following commands:

```
# In one terminal
docker-compose up

# Open another tab or terminal
docker-compose exec contracts-env bash

# A new Bash terminal is prompted, connected to the container
npm run test
```
