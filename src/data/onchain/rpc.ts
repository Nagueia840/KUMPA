import { createPublicClient, formatEther, http } from 'viem';
import { mainnet } from 'viem/chains';
import { loadEnv } from '../../config/env.js';

export type EthAddress = `0x${string}`;

/** Tipo inferido del cliente RPC (compatible con viem sin anotación explícita). */
export type RpcClient = ReturnType<typeof createRpcClient>;

/** Cliente RPC de Ethereum vía viem (gratis con RPC público o Alchemy). */
export function createRpcClient(url: string) {
  return createPublicClient({ chain: mainnet, transport: http(url) });
}

/** Crea el cliente RPC por defecto: Alchemy si hay key, sino RPC público. */
export function createDefaultRpcClient() {
  const env = loadEnv();
  const url = env.ALCHEMY_API_KEY
    ? `https://eth-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`
    : 'https://ethereum-rpc.publicnode.com';
  return createRpcClient(url);
}

export async function getEthBalance(client: RpcClient, address: EthAddress): Promise<number> {
  const wei = await client.getBalance({ address });
  return Number(formatEther(wei));
}

export async function getBlockNumber(client: RpcClient): Promise<number> {
  return Number(await client.getBlockNumber());
}

export async function getGasPrice(client: RpcClient): Promise<number> {
  return Number(await client.getGasPrice());
}
