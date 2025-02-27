import Client from "@walletconnect/sign-client";
import { JsonRpcProvider } from "@walletconnect/jsonrpc-provider";
import { HttpConnection } from "@walletconnect/jsonrpc-http-connection";
import { EngineTypes, SessionTypes } from "@walletconnect/types";

import {
  IProvider,
  RpcProvidersMap,
  SubProviderOpts,
  RequestParams,
  SessionNamespace,
} from "../types";

import { getChainId, getGlobal, getRpcUrl, validateChainApproval } from "../utils";
import EventEmitter from "events";
import { PROVIDER_EVENTS } from "../constants";

class Eip155Provider implements IProvider {
  public name = "eip155";
  public client: Client;
  // the active chainId on the dapp
  public chainId: number;
  public namespace: SessionNamespace;
  public httpProviders: RpcProvidersMap;
  public events: EventEmitter;

  constructor(opts: SubProviderOpts) {
    this.namespace = opts.namespace;
    this.events = getGlobal("events");
    this.client = getGlobal("client");
    this.httpProviders = this.createHttpProviders();
    this.chainId = parseInt(this.getDefaultChain());
  }

  public async request<T = unknown>(args: RequestParams): Promise<T> {
    switch (args.request.method) {
      case "eth_requestAccounts":
        return this.getAccounts() as any;
      case "eth_accounts":
        return this.getAccounts() as any;
      case "wallet_switchEthereumChain": {
        this.handleSwitchChain(args.request.params ? args.request.params[0]?.chainId : "0x0");
        return null as any;
      }
      case "eth_chainId":
        return parseInt(this.getDefaultChain()) as any;
      default:
        break;
    }
    if (this.namespace.methods.includes(args.request.method)) {
      return await this.client.request(args as EngineTypes.RequestParams);
    }
    return this.getHttpProvider().request(args.request);
  }

  public updateNamespace(namespace: SessionTypes.Namespace) {
    this.namespace = Object.assign(this.namespace, namespace);
  }

  public setDefaultChain(chainId: string, rpcUrl?: string | undefined) {
    const parsedChain = getChainId(chainId);
    // http provider exists so just set the chainId
    if (!this.httpProviders[parsedChain]) {
      const rpc =
        rpcUrl ||
        getRpcUrl(`${this.name}:${parsedChain}`, this.namespace, this.client.core.projectId);
      if (!rpc) {
        throw new Error(`No RPC url provided for chainId: ${parsedChain}`);
      }
      this.setHttpProvider(parsedChain, rpc);
    }
    this.chainId = parsedChain;
    this.events.emit(PROVIDER_EVENTS.DEFAULT_CHAIN_CHANGED, `${this.name}:${parsedChain}`);
  }

  public requestAccounts(): string[] {
    return this.getAccounts();
  }

  public getDefaultChain(): string {
    if (this.chainId) return this.chainId.toString();
    if (this.namespace.defaultChain) return this.namespace.defaultChain;

    const chainId = this.namespace.chains[0];
    if (!chainId) throw new Error(`ChainId not found`);

    return chainId.split(":")[1];
  }

  // ---------- Private ----------------------------------------------- //

  private createHttpProvider(
    chainId: number,
    rpcUrl?: string | undefined,
  ): JsonRpcProvider | undefined {
    const rpc =
      rpcUrl || getRpcUrl(`${this.name}:${chainId}`, this.namespace, this.client.core.projectId);
    if (typeof rpc === "undefined") return undefined;
    const http = new JsonRpcProvider(new HttpConnection(rpc, getGlobal("disableProviderPing")));
    return http;
  }

  private setHttpProvider(chainId: number, rpcUrl?: string): void {
    const http = this.createHttpProvider(chainId, rpcUrl);
    if (http) {
      this.httpProviders[chainId] = http;
    }
  }

  private createHttpProviders(): RpcProvidersMap {
    const http = {};
    this.namespace.chains.forEach((chain) => {
      const parsedChain = getChainId(chain);
      http[parsedChain] = this.createHttpProvider(parsedChain, this.namespace.rpcMap?.[chain]);
    });
    return http;
  }

  private getAccounts(): string[] {
    const accounts = this.namespace.accounts;
    if (!accounts) {
      return [];
    }
    return [
      ...new Set(
        accounts
          // get the accounts from the active chain
          .filter((account) => account.split(":")[1] === this.chainId.toString())
          // remove namespace & chainId from the string
          .map((account) => account.split(":")[2]),
      ),
    ];
  }

  private getHttpProvider(): JsonRpcProvider {
    const chain = this.chainId;
    const http = this.httpProviders[chain];
    if (typeof http === "undefined") {
      throw new Error(`JSON-RPC provider for ${chain} not found`);
    }
    return http;
  }

  private handleSwitchChain(newChainId: string) {
    const chainId = parseInt(newChainId, 16);
    const caipChainId = `${this.name}:${chainId}`;
    validateChainApproval(caipChainId, this.namespace.chains);
    this.setDefaultChain(`${chainId}`);
  }
}

export default Eip155Provider;
