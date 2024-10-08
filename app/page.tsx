"use client";

import { useEffect, useState } from "react";
import { Commitment, ConfirmOptions, Connection, Keypair, PublicKey, SendTransactionError, Transaction, clusterApiUrl, sendAndConfirmTransaction } from "@solana/web3.js";
import { AnchorProvider, Program, web3, utils, BN } from "@project-serum/anchor";
import idl from "./idl.json";
import { Buffer } from "buffer";
window.Buffer = Buffer;
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddress,
  mintTo,
  getAccount,
  createAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getMint
} from '@solana/spl-token'
import dotenv from "dotenv";
require('dotenv').config();

const programID = new PublicKey(idl.metadata.address);
const network = clusterApiUrl("devnet");
const opts: ConfirmOptions = {
  preflightCommitment: "processed" as Commitment,
};
const { SystemProgram } = web3;

declare global {
  interface Window {
    solana: any;
  }
}

const App = () => {
  const [walletAddress, setWalletAddress] = useState<string | null | undefined>(null);
  const [phantomNotInstalled, setPhantomNotInstalled] = useState(false);
  const [slpBalance, setSlpBalance] = useState<number>(0);
  const [isFaucetLoading, setIsFaucetLoading] = useState(false);
  const [isDepositLoading, setIsDepositLoading] = useState(false);
  const [isWithdrawLoading, setIsWithdrawLoading] = useState(false);
  const [lastTransactionSignature, setLastTransactionSignature] = useState<string | null>(null);
  const [programDetails, setProgramDetails] = useState({
    owner: "",
    programBalance: 0,
    tokenMint: "",
    fee: 0,
    vault: ""
  });

  const getProvider = () => {
    const connection = new Connection(network, opts.preflightCommitment as Commitment);
    const provider = new AnchorProvider(connection, (window as any).solana, opts);
    return provider;
  };

  const getOrCreateAssociatedTokenAccount = async (mintAddress: string, publicKey: PublicKey) => {
    const provider = getProvider();
    const mint = new PublicKey(mintAddress);
    const owner = provider.wallet.publicKey;

    try {
      const associatedTokenAddress = await getAssociatedTokenAddress(
        mint,
        owner
      );

      try {
        // Try to get the token account
        await getAccount(provider.connection, associatedTokenAddress);
      } catch (error) {
        console.log("Creating associated token account...");
        const transaction = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            owner,
            associatedTokenAddress,
            owner,
            mint
          )
        );

        const { blockhash } = await provider.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = owner;

        // Sign and send the transaction
        const signedTx = await (window as any).solana.signTransaction(transaction);
        const txid = await provider.connection.sendRawTransaction(signedTx.serialize());
        await provider.connection.confirmTransaction(txid);
      }

      return associatedTokenAddress;
    } catch (error) {
      console.error("Error in getOrCreateAssociatedTokenAccount:", error);
      throw error;
    }
  };

  const getBalanceSLP = async () => {
    try {
      const provider = getProvider();
      const associatedTokenAddress = await getOrCreateAssociatedTokenAccount(idl.mintAddress, provider.wallet.publicKey);
      await getProgramDetails();
      const tokenAccountInfo = await getAccount(provider.connection, associatedTokenAddress);
      const balance = Number(tokenAccountInfo.amount) / Math.pow(10, 9); // Assuming 9 decimals
      setSlpBalance(balance);

      console.log("SLP Balance:", balance);
      return balance;
    } catch (err) {
      console.error("Error fetching token balance:", err);
      setSlpBalance(0);
      return null;
    }
  };

  const faucetSLP = async () => {
    if (!walletAddress) return;
    setIsFaucetLoading(true);
    try {
      console.log("Starting faucet process...");
      const secretKeyArray = JSON.parse(process.env.NEXT_PUBLIC_SECRET_KEY_BYTES!);
      const secretKey = new Uint8Array(secretKeyArray);
      const faucetKeypair = Keypair.fromSecretKey(secretKey);

      console.log("Connecting to network...");
      let connection = new web3.Connection(web3.clusterApiUrl("devnet"), "confirmed");
      const mintAddress = new PublicKey(idl.mintAddress);
      const userPublicKey = new PublicKey(walletAddress);

      console.log("Checking mint authority...");
      const mintInfo = await getMint(connection, mintAddress);
      if (!mintInfo.mintAuthority?.equals(faucetKeypair.publicKey)) {
        throw new Error("Faucet keypair is not authorized to mint tokens");
      }

      console.log("Getting associated token address...");
      const associatedTokenAddress = await getAssociatedTokenAddress(
        mintAddress,
        userPublicKey
      );

      console.log("Checking if associated token account exists...");
      const accountInfo = await connection.getAccountInfo(associatedTokenAddress);
      let transaction = new Transaction();
      if (!accountInfo) {
        console.log("Creating associated token account...");
        const createATAIx = createAssociatedTokenAccountInstruction(
          faucetKeypair.publicKey,
          associatedTokenAddress,
          userPublicKey,
          mintAddress
        );
        transaction.add(createATAIx);
      }

      console.log("Creating mint instruction...");
      const mintAmount = Number(1_000_000_000);
      const mintInstruction = createMintToInstruction(
        mintAddress,
        associatedTokenAddress,
        faucetKeypair.publicKey,
        mintAmount
      );
      transaction.add(mintInstruction);

      console.log("Preparing transaction...");
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = faucetKeypair.publicKey;

      console.log("Sending and confirming transaction...");
      const sendPromise = sendAndConfirmTransaction(
        connection,
        transaction,
        [faucetKeypair],
        {
          commitment: 'confirmed',
          maxRetries: 5,
        }
      );

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Transaction timeout")), 120000)
      );

      const signature = await Promise.race([sendPromise, timeoutPromise]);
      setLastTransactionSignature(signature as string);
      console.log("Transaction confirmed. Signature:", signature);

      await getBalanceSLP();
    } catch (error) {
      console.error("Detailed error in faucetSLP:", error);
      if (error instanceof Error) {
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
      }
      alert(`Faucet error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsFaucetLoading(false);
    }
  };

  const getProgramDetails = async () => {
    try {
      const provider = getProvider();
      const program = new Program(idl as any, programID, provider);

      console.log("Program ID:", programID.toString());

      const accounts = await program.account.vault.all();

      console.log("accounts", accounts);

      if (accounts.length > 0) {
        const vaultAccount = accounts[0].account as {
          tokenMint: PublicKey;
          fee: number;
          bump: number;
          owner: PublicKey;
        };
        console.log("vaultAccount", vaultAccount);

        const [vaultPda, _] = await PublicKey.findProgramAddress(
          [Buffer.from('vault')],
          program.programId
        );
        console.log("vaultPda", vaultPda.toString());
        const vaultTokenAccount = await getAssociatedTokenAddress(
          new PublicKey(idl.mintAddress),
          vaultPda,
          true
        );

        const vaultTokenAccountInfo = await provider.connection.getAccountInfo(vaultTokenAccount);
        let programBalance = 0;
        if (vaultTokenAccountInfo) {
          const tokenAmount = vaultTokenAccountInfo.data.readBigUInt64LE(64);
          programBalance = Number(tokenAmount) / Math.pow(10, 9); // Assuming 9 decimals
        }

        console.log("programBalance", programBalance);

        setProgramDetails({
          owner: vaultAccount.owner.toString(),
          programBalance: programBalance,
          tokenMint: vaultAccount.tokenMint.toString(),
          fee: Number(vaultAccount.fee) / 100,
          vault: vaultPda.toString()
        });
      } else {
        console.log("No vault accounts found");
        setProgramDetails({
          owner: "Unknown",
          programBalance: 0,
          tokenMint: "Unknown",
          fee: 0,
          vault: "Unknown"
        });
      }
    } catch (error) {
      console.error("Error fetching program details:", error);
    }
  };

  const deposit = async () => {
    if (!walletAddress) {
      alert("Please connect your wallet first.");
      return;
    }
    setIsDepositLoading(true);
    try {
      const provider = getProvider();
      const program = new Program(idl as any, programID, provider);

      // Get the mint address from program details
      const mintPubkey = new PublicKey(idl.mintAddress);

      // Get user's token account
      const userTokenAccount = await getAssociatedTokenAddress(
        mintPubkey,
        provider.wallet.publicKey
      );

      // Check user's token balance
      const userTokenAccountInfo = await getAccount(provider.connection, userTokenAccount);
      const userBalance = Number(userTokenAccountInfo.amount);
      console.log("User balance:", userBalance);

      const depositAmount = new BN(1_000_000_000);

      if (depositAmount.gt(new BN(userBalance))) {
        alert("Insufficient balance. Your current balance is " + (userBalance / 1e9) + " SLP");
        return;
      }

      // Find the vault PDA
      const [vaultPda, _] = await PublicKey.findProgramAddress(
        [Buffer.from('vault')],
        program.programId
      );

      // Get or create vault token account
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mintPubkey,
        vaultPda,
        true // allowOwnerOffCurve set to true for PDA
      );

      // Check if vault token account exists, if not, create it
      const vaultTokenAccountInfo = await provider.connection.getAccountInfo(vaultTokenAccount);
      if (!vaultTokenAccountInfo) {
        console.log("Creating vault token account...");
        const createVaultTokenAccountIx = createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey, // payer
          vaultTokenAccount,
          vaultPda,
          mintPubkey
        );
        const createVaultTokenAccountTx = new Transaction().add(createVaultTokenAccountIx);
        const { blockhash } = await provider.connection.getLatestBlockhash();
        createVaultTokenAccountTx.recentBlockhash = blockhash;
        createVaultTokenAccountTx.feePayer = provider.wallet.publicKey;

        const signedCreateVaultTokenAccountTx = await provider.wallet.signTransaction(createVaultTokenAccountTx);
        const createVaultTokenAccountTxid = await provider.connection.sendRawTransaction(signedCreateVaultTokenAccountTx.serialize());
        await provider.connection.confirmTransaction(createVaultTokenAccountTxid);
        console.log("Vault token account created:", createVaultTokenAccountTxid);
      }

      // Find PDA for user deposit
      const [userDepositPda] = await PublicKey.findProgramAddress(
        [
          Buffer.from('user_deposit'),
          vaultPda.toBuffer(),
          provider.wallet.publicKey.toBuffer()
        ],
        program.programId
      );

      // Prepare the deposit transaction
      const tx = await program.methods
        .deposit(depositAmount)
        .accounts({
          vault: vaultPda,
          userDeposit: userDepositPda,
          user: provider.wallet.publicKey,
          userTokenAccount: userTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId
        })
        .transaction();

      // Send the transaction using Phantom wallet
      const { blockhash } = await provider.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = provider.wallet.publicKey;

      const signedTx = await provider.wallet.signTransaction(tx);
      const txid = await provider.connection.sendRawTransaction(signedTx.serialize());
      await provider.connection.confirmTransaction(txid);

      console.log("Deposit transaction signature:", txid);
      setLastTransactionSignature(txid);

      // Refresh balances
      await getBalanceSLP();
      await getProgramDetails();

    } catch (error) {
      console.error("Error in deposit:", error);
    } finally {
      setIsDepositLoading(false);
    }
  };

  const withdraw = async () => {
    if (!walletAddress) {
      alert("Please connect your wallet first.");
      return;
    }
    setIsWithdrawLoading(true);
    try {
      const provider = getProvider();
      const program = new Program(idl as any, programID, provider);

      // Find the vault PDA
      const [vaultPda, _] = await PublicKey.findProgramAddress(
        [Buffer.from('vault')],
        program.programId
      );

      // Get the mint address from program details
      const mintPubkey = new PublicKey(programDetails.tokenMint);

      // Get or create user's token account
      const userTokenAccount = await getOrCreateAssociatedTokenAccount(
        mintPubkey.toString(),
        provider.wallet.publicKey
      );

      // Find PDA for user deposit
      const [userDepositPda] = await PublicKey.findProgramAddress(
        [
          Buffer.from('user_deposit'),
          vaultPda.toBuffer(),
          provider.wallet.publicKey.toBuffer()
        ],
        program.programId
      );

      // Get the user deposit account info
      console.log("===========>", userDepositPda.toString());
      const userDepositAccount = await program.account.userDeposit.fetch(userDepositPda) as { amount: BN };
      const userDepositBalance = userDepositAccount.amount.toNumber();
      console.log("User deposit balance:=====>", userDepositBalance);

      // Get the vault's token account
      const vaultTokenAccount = await getAssociatedTokenAddress(
        mintPubkey,
        vaultPda,
        true // allowOwnerOffCurve set to true for PDA
      );

      // Get the fee account (assuming it's the same as the owner's associated token account)
      const feeAccount = await getAssociatedTokenAddress(
        mintPubkey,
        new PublicKey(programDetails.owner)
      );

      const withdrawAmount = new BN(1_000_000_000); // Withdraw 1 token

      // Check if user deposit balance is sufficient
      console.log("withdrawAmount==========", withdrawAmount.toNumber());
      if (withdrawAmount.gt(new BN(userDepositBalance))) {
        alert("Insufficient balance in user deposit account.");
        return;
      }

      // Prepare the withdraw transaction
      const tx = await program.methods
        .withdraw(withdrawAmount)
        .accounts({
          vault: vaultPda,
          userDeposit: userDepositPda,
          user: provider.wallet.publicKey,
          userTokenAccount: userTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          feeAccount: feeAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .transaction();

      // Send the transaction using Phantom wallet
      const { blockhash } = await provider.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = provider.wallet.publicKey;

      const signedTx = await provider.wallet.signTransaction(tx);
      const txid = await provider.connection.sendRawTransaction(signedTx.serialize());
      await provider.connection.confirmTransaction(txid);

      // console.log("Withdraw transaction signature:", txid);
      // setLastTransactionSignature(txid);

      // Refresh balances
      await getBalanceSLP();
      await getProgramDetails();
    } catch (error) {
      console.error("Error in withdraw:", error);

      if (error instanceof SendTransactionError) {
        alert(`Withdraw failed: ${error.message}`);
      } else {
        alert(`Withdraw error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } finally {
      setIsWithdrawLoading(false);
    }
  };

  const checkIfWalletIsConnected = async () => {
    try {
      const { solana } = window;
      if (solana) {
        if (solana.isPhantom) {
          console.log("Phantom wallet found!");
          const response = await solana.connect({ onlyIfTrusted: true });
          console.log("Connected with public key:", response.publicKey.toString());
          setWalletAddress(response.publicKey.toString());
          await getBalanceSLP();
        }
      } else {
        setPhantomNotInstalled(true);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const connectWallet = async () => {
    const { solana } = window;
    if (solana) {
      const response = await solana.connect();
      console.log("Connected with public key:", response.publicKey.toString());
      setWalletAddress(response.publicKey.toString());
      await getBalanceSLP();
    }
  };

  useEffect(() => {
    const onLoad = async () => {
      await checkIfWalletIsConnected();
      await getProgramDetails();
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  const renderNotConnectedContainer = () => (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      {phantomNotInstalled ? (
        <a
          href="https://phantom.app/download"
          target="_blank"
          rel="noopener noreferrer"
          className="bg-purple-500 hover:bg-purple-600 text-white font-bold py-4 px-8 rounded-lg text-xl"
        >
          Download Phantom Wallet
        </a>
      ) : (
        <button
          className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 px-8 rounded-lg text-xl"
          onClick={connectWallet}
        >
          Connect to Wallet
        </button>
      )}
    </div>
  );

  const renderConnectedContainer = () => {
    const truncatedAddress = `${walletAddress?.slice(0, 5)}...${walletAddress?.slice(-5)}` || '';
    const explorerUrl = lastTransactionSignature
      ? `https://solscan.io/tx/${lastTransactionSignature}?cluster=devnet`
      : null;

    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="bg-purple-100 p-16 rounded-lg shadow-md w-full max-w-4xl">
          {/* Connected Address Section */}
          <div className="text-center text-green-600 text-3xl mb-8">
            Connected: {truncatedAddress} <strong>with balance {slpBalance} SLP</strong>
            {explorerUrl && (
              <div>
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-500 hover:text-blue-700 font-bold underline"
                >
                  View Last Transaction
                </a>
              </div>
            )}
          </div>

          {/* Centered Faucet Heading */}
          <div className="flex justify-center mb-12">
            <button
              className="text-5xl bg-orange-600 hover:bg-orange-800 py-4 px-12 rounded font-bold text-center"
              onClick={faucetSLP}
              disabled={isFaucetLoading}
            >
              {isFaucetLoading ? 'Minting...' : 'Token SLP Faucet'}
            </button>
          </div>

          {/* Details Section */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-6 text-2xl text-black">
            <div className="font-bold text-left">Owner (Program Owner):</div>
            <div className="text-left break-words">
              {programDetails.owner}
            </div>

            <div className="font-bold text-left">Program Balance:</div>
            <div className="text-left">{programDetails.programBalance} SLP</div>

            <div className="font-bold text-left">Token Mint:</div>
            <div className="text-left break-words">
              {programDetails.tokenMint}
            </div>

            <div className="font-bold text-left">Vault:</div>
            <div className="text-left break-words">
              {programDetails.vault}
            </div>

            <div className="font-bold text-left">Fee system:</div>
            <div className="text-left break-words">
              {programDetails.fee}%
            </div>
          </div>

          {/* Buttons Section */}
          <div className="mt-16 flex justify-center space-x-8">
            <button
              className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 px-12 rounded text-2xl"
              onClick={deposit}
              disabled={isDepositLoading}
            >
              {isDepositLoading ? 'Depositing...' : 'Deposit 1 SLP'}
            </button>
            <button
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-4 px-12 rounded text-2xl"
              onClick={withdraw}
              disabled={isWithdrawLoading}
            >
              {isWithdrawLoading ? 'Withdrawing...' : 'Withdraw 1 SLP'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="App">
      {!walletAddress && renderNotConnectedContainer()}
      {walletAddress && renderConnectedContainer()}
    </div>
  );
};

export default App;