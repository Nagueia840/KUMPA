import { postJSON } from '../http.js';

export interface FlipsideQueryResults {
  columnNames?: string[];
  rows?: unknown[][];
  status?: string;
}

interface CreateRunResponse {
  queryRun?: { id: string };
}

interface GetResultsResponse {
  result?: FlipsideQueryResults;
}

/**
 * Cliente de Flipside (SQL on-chain vía JSON-RPC). Requiere FLIPSIDE_API_KEY.
 * NOTA: los shapes exactos se verifican contra la API real al probar con key.
 */
export class FlipsideClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseURL = 'https://api-v2.flipsidecrypto.xyz/json-rpc',
  ) {}

  async runQuery(sql: string, ttlMinutes = 15): Promise<FlipsideQueryResults> {
    const headers = { 'x-api-key': this.apiKey };

    const create = await postJSON<CreateRunResponse>(
      this.baseURL,
      {
        jsonrpc: '2.0',
        method: 'createQueryRun',
        params: [{ sql, ttlMinutes, maxAgeMinutes: 0 }],
        id: 1,
      },
      { headers },
    );

    const runId = create.queryRun?.id;
    if (!runId) throw new Error('Flipside no devolvió un queryRun id');

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await postJSON<GetResultsResponse>(
        this.baseURL,
        {
          jsonrpc: '2.0',
          method: 'getQueryResults',
          params: [{ queryRunId: runId, format: 'json' }],
          id: 1,
        },
        { headers },
      );
      const status = res.result?.status;
      if (status === 'finished' || status === 'QUERY_STATE_SUCCESS') return res.result ?? {};
      if (status === 'failed' || status === 'QUERY_STATE_FAILED') {
        throw new Error('Query Flipside falló');
      }
    }
    throw new Error('Timeout esperando query Flipside');
  }
}
