const fetch = require("node-fetch");
const ethers = require("ethers");
const blocknativeBundleRandomPrivateKey =
  "0x2017055c7beb074c0f60c049da3770965e922b3b0c34d37fefbf8b51bd99b411";

// Block number is the current block number not the target one
const sendBundleCustomProvider = async (
  url,
  id,
  signedTransactions,
  blockNumber,
  name
) => {
  console.log("Sending bundle to:", url);
  let body = JSON.stringify({
    jsonrpc: "2.0",
    id: id,
    method: "eth_sendBundle",
    params: [
      {
        txs: signedTransactions, // Array[String], A list of signed transactions to execute in an atomic bundle
        blockNumber: ethers.utils.hexValue(blockNumber + 1), // String, a hex encoded block number for which this bundle is valid on
      },
    ],
  });
  let headers = {
    "Content-Type": "application/json",
  };

  switch (name) {
    case "eden":
    case "flashbots":
      const signingWalletA = new ethers.Wallet(
        blocknativeBundleRandomPrivateKey
      );
      headers = {
        ...headers,
        "X-Flashbots-Signature":
          signingWalletA.address +
          ":" +
          (await signingWalletA.signMessage(ethers.utils.id(body))),
      };
      break;
    case "blocknative":
      const signingWallet = new ethers.Wallet(
        blocknativeBundleRandomPrivateKey
      );
      headers = {
        ...headers,
        "X-Auction-Signature":
          signingWallet.address +
          ":" +
          (await signingWallet.signMessage(ethers.utils.id(body))),
      };
      break;
  }

  return fetch(url, {
    method: "post",
    headers,
    body,
  })
    .then((response) => {
      console.log(`${url} response`, response.status);
      return response.json();
    })
    .then((jsonResponse) => {
      console.log(`${url} json response:`, jsonResponse);
    })
    .catch((e) => {
      console.log(`Error ${url}`, e);
    });
};

// Block number is the current block number not the target one
const sendFlashbots = async (
  transactionsArray,
  blockNumber,
  flashbotsProvider,
  edenProvider
) => {
  const signedTransactions = await flashbotsProvider.signBundle(
    transactionsArray
  );
  const signedTransactionsEden = await edenProvider.signBundle(
    transactionsArray
  );
  console.log("Submitting bundle...");

  await Promise.all([
    sendBundleCustomProvider(
      "https://builder.gmbit.co/rpc",
      1,
      signedTransactions,
      blockNumber
    ),
    sendBundleCustomProvider(
      "https://rpc.beaverbuild.org",
      1,
      signedTransactions,
      blockNumber
    ),
    sendBundleCustomProvider(
      "https://builder0x69.io",
      42069,
      signedTransactions,
      blockNumber
    ),
    sendBundleCustomProvider(
      "https://rsync-builder.xyz",
      1,
      signedTransactions,
      blockNumber
    ),
    sendBundleCustomProvider(
      "https://api.securerpc.com/v1",
      1,
      signedTransactions,
      blockNumber
    ),
    sendBundleCustomProvider(
      "https://rpc.payload.de",
      1,
      signedTransactions,
      blockNumber
    ),
    sendBundleCustomProvider(
      "https://buildai.net",
      1,
      signedTransactions,
      blockNumber
    ),
    sendBundleCustomProvider(
      "https://eth-builder.com",
      1,
      signedTransactions,
      blockNumber
    ),
    sendBundleCustomProvider(
      "https://rpc.titanbuilder.xyz",
      1,
      signedTransactions,
      blockNumber
    ),
    sendBundleCustomProvider(
      "https://api.edennetwork.io/v1/bundle",
      1,
      signedTransactionsEden,
      blockNumber,
      "eden"
    ),
    sendBundleCustomProvider(
      "https://relay.flashbots.net",
      1,
      signedTransactions,
      blockNumber,
      "flashbots"
    ),
  ]);
};

// Returns an ethers.BigNumber not a BNbignumber.js
const calculateNextBaseFee = (currentBlock) => {
  const baseFee = currentBlock.baseFeePerGas;
  const gasUsed = currentBlock.gasUsed;
  const targetGasUsed = currentBlock.gasLimit.div(3);
  const delta = gasUsed.sub(targetGasUsed);

  const newBaseFee = baseFee.add(
    baseFee.mul(delta).div(targetGasUsed).div(ethers.BigNumber.from(8))
  );

  // Add 0-9 wei so it becomes a different hash each time
  const rand = Math.floor(Math.random() * 10);
  return newBaseFee.add(rand);
};

// Simulate and returns an array for the gas used on every transaction OR false if it fails
const simulateAndReturnGasLimits = async (
  flashbotsProvider,
  transactionsArray,
  blockNumber
) => {
  try {
    const signedTransactions = await flashbotsProvider.signBundle(
      transactionsArray
    );

    console.log("Starting to run the simulation...");
    const simulation = await flashbotsProvider.simulate(
      signedTransactions,
      blockNumber + 1
    );
    console.log("simulation", simulation);
    if (simulation.firstRevert || simulation.error) {
      return false;
    } else {
      console.log(`Simulation Success: ${blockNumber}`);
      return simulation.results.map((item) => item.gasUsed);
    }
  } catch (e) {
    console.log("error simulateAndReturnGasLimits", e);
    return false;
  }
};

module.exports = {
  sendFlashbots,
  calculateNextBaseFee,
  simulateAndReturnGasLimits,
};
