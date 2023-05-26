import rawBRE from 'hardhat';
import { initializeMakeSuite } from './helpers/make-suite';

before(async () => {
  await rawBRE.deployments.fixture(['light-dao', 'market', 'lending-gauge']);

  console.log('-> Deployed market');

  console.log('-> Initializing test environment');
  await initializeMakeSuite();
  console.log('\n***************');
  console.log('Setup and snapshot finished');
  console.log('***************\n');
});
