import HttpConnection from "@walletconnect/jsonrpc-http-connection";
import { JsonRpcProvider } from "@walletconnect/jsonrpc-provider";
import Client from "@walletconnect/sign-client";
import { EngineTypes, SessionTypes } from "@walletconnect/types";
import EventEmitter from "events";
import { PROVIDER_EVENTS } from "../constants";
import {
  IProvider,
  RequestParams,
  RpcProvidersMap,
  SessionNamespace,
  SubProviderOpts,
} from "../types";
import { getGlobal, getRpcUrl } from "../utils";

class CosmosProvider implements IProvider {
  public name = "cosmos";
  public client: Client;
  public httpProviders: RpcProvidersMap;
  public events: EventEmitter;
  public namespace: SessionNamespace;
  public chainId: string;

  constructor(opts: SubProviderOpts) {
    this.namespace = opts.namespace;
    this.events = getGlobal("events");
    this.client = getGlobal("client");
    this.chainId = this.getDefaultChain();
    this.httpProviders = this.createHttpProviders();
  }

  public updateNamespace(namespace: SessionTypes.Namespace) {
    this.namespace = Object.assign(this.namespace, namespace);
  }

  public requestAccounts(): string[] {
    return this.getAccounts();
  }

  public getDefaultChain(): string {
    if (this.chainId) return this.chainId;
    if (this.namespace.defaultChain) return this.namespace.defaultChain;

    const chainId = this.namespace.chains[0];

    if (!chainId) throw new Error(`ChainId not found`);

    return chainId.split(":")[1];
  }

  public request<T = unknown>(args: RequestParams): Promise<T> {
    if (this.namespace.methods.includes(args.request.method)) {
      return this.client.request(args as EngineTypes.RequestParams);
    }
    return this.getHttpProvider().request(args.request);
  }

  public setDefaultChain(chainId: string, rpcUrl?: string | undefined) {
    this.chainId = chainId;
    // http provider exists so just set the chainId
    if (!this.httpProviders[chainId]) {
      const rpc =
        rpcUrl || getRpcUrl(`${this.name}:${chainId}`, this.namespace, this.client.core.projectId);
      if (!rpc) {
        throw new Error(`No RPC url provided for chainId: ${chainId}`);
      }
      this.setHttpProvider(chainId, rpc);
    }

    this.events.emit(PROVIDER_EVENTS.DEFAULT_CHAIN_CHANGED, `${this.name}:${this.chainId}`);
  }

  // ---------------- PRIVATE ---------------- //

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

  private createHttpProviders(): RpcProvidersMap {
    const http = {};
    this.namespace.chains.forEach((chain) => {
      http[chain] = this.createHttpProvider(chain, this.namespace.rpcMap?.[chain]);
    });
    return http;
  }

  private getHttpProvider(): JsonRpcProvider {
    const chain = `${this.name}:${this.chainId}`;
    const http = this.httpProviders[chain];
    if (typeof http === "undefined") {
      throw new Error(`JSON-RPC provider for ${chain} not found`);
    }
    return http;
  }

  private setHttpProvider(chainId: string, rpcUrl?: string): void {
    const http = this.createHttpProvider(chainId, rpcUrl);
    if (http) {
      this.httpProviders[chainId] = http;
    }
  }

  private createHttpProvider(
    chainId: string,
    rpcUrl?: string | undefined,
  ): JsonRpcProvider | undefined {
    const rpc = rpcUrl || getRpcUrl(chainId, this.namespace, this.client.core.projectId);
    if (typeof rpc === "undefined") return undefined;
    const http = new JsonRpcProvider(new HttpConnection(rpc, getGlobal("disableProviderPing")));
    return http;
  }
}

export default CosmosProvider;
