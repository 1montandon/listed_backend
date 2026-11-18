/**
 * POLÍTICA DE DESTINO COMPARTILHADA
 *
 * O cliente fetch e o proxy do Chromium compartilham estas regras. Aqui
 * interpretamos o endereço e escolhemos o IP. Quem vai abrir a conexão usa
 * exatamente esse IP para que uma nova consulta DNS não mude o destino.
 *
 * 1. parseUrl confere o endereço escrito (protocolo, domínio e porta).
 * 2. resolvePublicAddress consulta o resolvedor do sistema e confere seus IPs.
 *
 * São duas etapas porque um domínio aparentemente normal pode apontar para
 * 127.0.0.1 ou 10.0.0.2. Ao conectar nesses endereços, o backend alcançaria
 * seu próprio ambiente ou uma rede privada. O Listed restringe a coleta a
 * páginas da web em endereços públicos. Veja docs/etapas-iniciais/04-extracao-de-produtos.md#rede-e-proxy.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { PageFetchError } from "../products.errors.ts";

// Este tipo descreve uma função que recebe um hostname e devolve uma Promise.
// Quando ela termina com sucesso, seu valor é uma lista de endereços IPv4.
export type ResolveIPv4 = (hostname: string) => Promise<string[]>;

export class ProductUrlPolicy {
  private readonly resolveHostname: ResolveIPv4;

  constructor(resolveHostname: ResolveIPv4 = resolveIPv4) {
    // O parâmetro recebe uma função sem chamá-la. A consulta só ocorre dentro
    // de resolvePublicAddress, com o domínio daquele pedido. Os testes podem
    // passar uma função simulada no lugar de resolveIPv4, ao fim do arquivo.
    this.resolveHostname = resolveHostname;
  }

  /** Separa uma URL em partes e confere o que pode ser decidido só pelo texto. */
  parseUrl(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new PageFetchError("UNSAFE_TARGET");
    }

    const usesHttp = url.protocol === "http:" || url.protocol === "https:";
    if (!usesHttp) throw new PageFetchError("UNSAFE_TARGET");

    // Não enviamos usuário/senha embutidos em links como https://user:pass@loja.
    if (url.username !== "" || url.password !== "") throw new PageFetchError("UNSAFE_TARGET");

    // URL remove as portas padrão: :80 no HTTP e :443 no HTTPS viram "".
    // Uma porta que restou, como :5432 ou :8080, está fora da política do MVP.
    if (url.port !== "") throw new PageFetchError("UNSAFE_TARGET");

    // IP literal é um endereço digitado diretamente no lugar de um nome.
    // Nesta rota pedimos um domínio. isIP devolve 4 ou 6 ao reconhecer um
    // endereço, ou 0 se não for IP. URL envolve IPv6 em colchetes, como [::1].
    const hostname = url.hostname.replace("[", "").replace("]", "");
    if (isIP(hostname) !== 0) throw new PageFetchError("UNSAFE_TARGET");

    // Um ponto final em localhost. representa o mesmo nome. \.$ procura só
    // esse ponto no fim, sem remover os pontos no meio de um domínio.
    const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
    if (normalizedHostname === "localhost") throw new PageFetchError("UNSAFE_TARGET");
    return url;
  }

  /**
   * Resolve o domínio e devolve o primeiro IPv4 que passa pela política.
   * Para uma resposta ["10.0.0.2", "93.184.215.14"], escolhe o segundo.
   * A aprovação vale para o IP devolvido nesta tentativa. Indica que a
   * biblioteca o classificou como comum, fora de suas faixas especiais.
   */
  async resolvePublicAddress(hostname: string, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new PageFetchError("TIMEOUT");

    // lookup não recebe esse AbortSignal. Criamos uma Promise para converter
    // o aviso de cancelamento em erro e parar de esperar pela consulta.
    // O executor de new Promise roda imediatamente. Ele registra onTimeout
    // para reagir ao evento abort e guarda a referência para remover no finally.
    let onTimeout = () => {};
    // A Promise de timeout só rejeita. Declaramos o mesmo tipo da consulta
    // porque o resultado útil da corrida continua sendo uma lista de IPs.
    const timeout = new Promise<string[]>((_resolve, reject) => {
      onTimeout = () => reject(new PageFetchError("TIMEOUT"));
      signal.addEventListener("abort", onTimeout, { once: true });
    });

    try {
      const lookupResult = this.resolveHostname(hostname);
      // race entrega o valor ou erro da primeira Promise que terminar.
      // A consulta pode continuar no sistema após timeout, mas o resultado
      // tardio não chega a quem aguardava um endereço para conectar.
      const addresses = await Promise.race([lookupResult, timeout]);
      for (const address of addresses) {
        if (!ipaddr.IPv4.isValid(address)) continue;
        const addressRange = ipaddr.IPv4.parse(address).range();
        // range classifica o endereço conforme a faixa a que pertence.
        // unicast é o nome que a biblioteca usa para o IPv4 comum restante
        // depois de separar redes privadas, loopback e faixas especiais.
        if (addressRange === "unicast") {
          return address;
        }
      }
      throw new PageFetchError("UNSAFE_TARGET");
    } catch (error) {
      if (error instanceof PageFetchError) throw error;
      throw new PageFetchError("FETCH_FAILED");
    } finally {
      // Se o DNS terminou primeiro, não precisamos continuar ouvindo o aviso.
      signal.removeEventListener("abort", onTimeout);
    }
  }
}

async function resolveIPv4(hostname: string): Promise<string[]> {
  // lookup consulta o resolvedor do sistema. all pede uma lista, family: 4
  // pede IPv4, e map pega só address de cada objeto recebido do Node.
  const results = await lookup(hostname, { all: true, family: 4 });
  return results.map((result) => result.address);
}
