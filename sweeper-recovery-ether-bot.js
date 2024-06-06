const { Wallet, ethers } = require("ethers");
const {
  sendFlashbots,
  calculateNextBaseFee,
  simulateAndReturnGasLimits,
} = require("./frontrunning-tools.js");
const {
  FlashbotsBundleProvider,
} = require("@flashbots/ethers-provider-bundle");
const { erc20Abi, erc20Bytecode, nftAbi, nftBytecode } = require("./abis");

const FLASHBOTS_URL = "https://relay.flashbots.net";
const EDEN_URL = "https://api.edennetwork.io/v1/bundle";
const chainId = 1;
const provider = new ethers.providers.JsonRpcProvider(
  "https://rpc.merkle.io/1/sk_mbs_26720b61f02aeb2b88d41f93e780981b"
);
const priorityFee = ethers.utils.parseUnits("50", "gwei");

// We're NOT gonna recover the remaining eth used when extracting the tokens for complexity because it could fail
const executeSweeperRecovery = async (
  blockNumber,
  baseFee,
  privateKeyAccountToSave,
  privateKeyReceiverAccount,
  amountToSend,
  erc20TokensToRescue // The tokens must be in the account to save
) => {
  const receiverAccount = new Wallet(privateKeyReceiverAccount).connect(
    provider
  );
  let flashbotsProvider = null;
  let edenProvider = null;
  try {
    flashbotsProvider = await FlashbotsBundleProvider.create(
      provider,
      receiverAccount,
      FLASHBOTS_URL
    );
    edenProvider = await FlashbotsBundleProvider.create(
      provider,
      receiverAccount,
      EDEN_URL
    );
  } catch (e) {
    return {
      ok: false,
      msg: "Error setting up the provider",
    };
  }

  // The private key is the account you want to save
  let amountToSendInEth = ethers.utils.parseUnits(amountToSend, "ether");
  if (!priorityFee) priorityFee = ethers.utils.parseUnits("10", "gwei");
  amountToSendInEth = amountToSendInEth.mul(9).div(10);
  const accountToSave = new Wallet(privateKeyAccountToSave).connect(provider);
  const erc20Factory = new ethers.ContractFactory(
    erc20Abi,
    erc20Bytecode,
    accountToSave
  );
  const nftFactory = new ethers.ContractFactory(
    nftAbi,
    nftBytecode,
    accountToSave
  );

  console.log("receiverAccount", receiverAccount.address);
  console.log("accountToSave", accountToSave.address);

  console.log("1 / 3: setup variables and transactions");
  // Send eth to the target account from receiverAccount to accountToSave
  const firstTransaction = {
    // must be signed by receiverAccount
    to: accountToSave.address,
    type: 2,
    data: "0x",
    maxPriorityFeePerGas: priorityFee,
    maxFeePerGas: baseFee.add(priorityFee),
    chainId,
    value: amountToSendInEth.toString(),
    gasLimit: 21000,
  };

  // Recover NFTs and ERCs
  let nftTransactions = [];
  let erc20Transactions = [];
  // Recover ERCs
  try {
    for (let i = 0; i < erc20TokensToRescue.length; i++) {
      const activeERC20 = erc20Factory.attach(erc20TokensToRescue[i]);
      const balance = await activeERC20.balanceOf(accountToSave.address);
      console.log("balance token", erc20TokensToRescue[i], balance.toString());
      let transaction = await activeERC20.populateTransaction.transfer(
        // Must be signed by the accountToSave
        receiverAccount.address,
        balance.toString(),
        {
          value: "0",
          type: 2,
          gasLimit: 300000, // Only the required gas will be used,
          maxFeePerGas: baseFee,
        }
      );
      transaction.chainId = chainId;
      erc20Transactions.push({
        signer: accountToSave,
        transaction,
      }); // The 0x must be removed for bloxroute
    }
  } catch (e) {
    return {
      ok: false,
      msg: "Error setting up the transfers",
    };
  }

  console.log("2 / 3: simulate transactions to see if they would work or not");
  let transactionsArray = [
    {
      signer: receiverAccount,
      transaction: firstTransaction,
    },
    ...erc20Transactions,
  ];

  let resultsSimulation;
  try {
    resultsSimulation = await simulateAndReturnGasLimits(
      flashbotsProvider,
      transactionsArray,
      blockNumber
    );
  } catch (e) {
    console.log("Error simulation", e);
    return {
      ok: false,
      msg: "Error executing simulation",
    };
  }
  if (!resultsSimulation) {
    return {
      ok: false,
      msg: "Simulation reverted",
    };
  }

  let gasCosts = baseFee.add(priorityFee).mul(String(resultsSimulation[0]));
  // This variable is important to determine how much to send to the account to save specifically
  let gasCostsAccountToSave = ethers.BigNumber.from("1"); // Sample initial value

  for (let i = 1; i < resultsSimulation.length; i++) {
    // Gas costs are base fee * gas limit for each transaction (plus the first one that has priority fee)
    gasCosts = gasCosts.add(baseFee.mul(4).mul(String(resultsSimulation[i])));
    gasCostsAccountToSave = gasCostsAccountToSave.add(
      baseFee.mul(4).mul(String(resultsSimulation[i]))
    );
  }
  console.log("baseFee", baseFee.toString());
  console.log("gasCosts", gasCosts.toString());
  console.log("gasCostsAccountToSave", gasCostsAccountToSave.toString());

  if (gasCosts.gt(amountToSendInEth)) {
    console.log(
      "Gas costs exceed input. Costs are:",
      gasCosts.toString(),
      "input is:",
      amountToSendInEth.toString()
    );
    return "Gas costs exceed input, increase input";
  } else {
    console.log(
      "Gas costs okay",
      gasCosts.toString(),
      "amount sent",
      amountToSendInEth.toString()
    );
  }

  console.log("3 / 3: send bundle");
  try {
    transactionsArray = [
      {
        signer: receiverAccount,
        transaction: {
          ...firstTransaction,
          value: amountToSendInEth.toString(),
        },
      },
      ...erc20Transactions,
    ];

    try {
      resultsSimulation = await simulateAndReturnGasLimits(
        flashbotsProvider,
        transactionsArray,
        blockNumber
      );
    } catch (e) {
      console.log("Error simulation", e);
      return {
        ok: false,
        msg: "Error executing simulation",
      };
    }
    if (!resultsSimulation) {
      return {
        ok: false,
        msg: "Simulation reverted",
      };
    }

    await sendFlashbots(
      transactionsArray,
      blockNumber,
      flashbotsProvider,
      edenProvider
    );
    console.log("3 / 3: sent!");
  } catch (e) {
    console.log("Error", e);
    return {
      ok: false,
      msg: "Error sending the flashbots bundle",
    };
  }

  return {
    ok: true,
  };
};

const asyncTimeout = (time) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
};

const start = async () => {
  console.log("Starting");

  /// User params
  let block, baseFee, blockNumber;
  let privateKeyAccountToSave = ""; // Add it here
  let privateKeyReceiverAccount = ""; // Add it here
  let amountToSend = "0.005";
  // The tokens must be in the account to save, pass a list like so ["0x78BB04E760ED1FF3Ef395d618A76b0750E7acd7f", "0xB188fF484f565BF32B345506D9B2C89255aEeAEb"]
  // the program will extract the entire balance of each token address you pass here
  let erc20TokensToRescue = ["0x0001A500A6B18995B03f44bb040A5fFc28E45CB0"];
  const intervalToCheck = 0.0; // every 1 second
  /// User params

  const accountToSave = new ethers.Wallet(privateKeyAccountToSave).connect(
    provider
  );
  const erc20 = new ethers.Contract(
    erc20TokensToRescue[0],
    erc20Abi,
    accountToSave
  );
  let balance;

  let checkingCount = 1;
  while (true) {
    try {
      balance = await erc20.balanceOf(accountToSave.address);
      if (balance == 0) {
        console.log("Checking count...", checkingCount);
        checkingCount++;
        // Check every second
        await asyncTimeout(intervalToCheck * 1e3);
        continue;
      } else {
        break;
      }
    } catch (e) {
      console.log("Couldn't check the balance, stopping");
      process.exit(0);
    }
  }

  while (true) {
    try {
      balance = await erc20.balanceOf(accountToSave.address);
      if (balance == 0) {
        console.log("Success!");
        process.exit(0);
      }
    } catch (e) {
      console.log("Couldn't get the balance, stopping");
      process.exit(0);
    }
    try {
      blockNumber = await provider.getBlockNumber();
      block = await provider.getBlock(blockNumber);
      baseFee = calculateNextBaseFee(block);
    } catch (e) {
      return console.log("Error getting the current block", e);
    }
    try {
      await executeSweeperRecovery(
        blockNumber,
        baseFee,
        privateKeyAccountToSave,
        privateKeyReceiverAccount,
        amountToSend,
        erc20TokensToRescue
      );
    } catch (e) {
      return console.log("Error executing the sweeper recovery", e);
    }
  }
};

start();
