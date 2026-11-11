// Limite da sugestão para o formulário. Se o trecho for maior, devolvemos
// null para evitar apresentar como nome uma parte arbitrária de uma URL longa.
const MAX_SUGGESTION_LENGTH = 160;
// A flag u permite ler categorias Unicode. Cc e Cf incluem controles e
// marcas invisíveis. U+FFFD sinaliza substituição de texto inválido.
const INVALID_TEXT_CHARACTERS = /[\p{Cc}\p{Cf}\uFFFD]/u;

/**
 * Sugere um nome para revisão a partir do slug, o trecho legível da URL.
 * Ex.: /tenis-de-corrida-123456.html → "Tenis De Corrida".
 * Os formatos são específicos dos domínios abaixo. Todo o trabalho é feito
 * sobre texto: new URL separa as partes do endereço sem acessar a loja.
 */
export function suggestProductName(url: string): string | null {
  // 1. LOCALIZAR O ENDEREÇO QUE CONTÉM O CAMINHO DO PRODUTO
  let productUrl = parseHttpsUrl(url);
  if (productUrl === null) return null;

  const isShopeeVerification = productUrl.hostname === "shopee.com.br"
    && productUrl.pathname.replace(/\/$/, "") === "/verify/traffic/error";
  if (isShopeeVerification) {
    // URLSearchParams lê e decodifica a camada externa do query parameter.
    // Ex.: next=%2Fvestido%2520floral-i.1.2 → /vestido%20floral-i.1.2.
    // O %20 restante pertence ao caminho do produto e será lido mais abaixo.
    const next = productUrl.searchParams.get("next");
    if (next === null) return null;

    // origin reúne protocolo, host e porta. A base permite que next seja um
    // caminho relativo. Só examinamos um destino HTTPS da mesma origem.
    const nextUrl = parseHttpsUrl(next, productUrl.origin);
    if (nextUrl === null || nextUrl.origin !== productUrl.origin) return null;
    productUrl = nextUrl;
    // A leitura seguinte exige um caminho de produto. Um segundo /verify
    // dentro de next fica sem sugestão porque não encaixa nesse formato.
  }

  // 2. SEPARAR E DECODIFICAR O TRECHO LEGÍVEL DO CAMINHO
  const slug = readProductSlug(productUrl);
  if (slug === null) return null;

  let decodedSlug: string;
  try {
    // Esta é a camada do caminho: %20 vira espaço e %C3%AA vira ê.
    // decodeURIComponent lança erro se os bytes escapados estiverem inválidos.
    // normalize("NFC") unifica formas equivalentes de escrever um acento:
    // um e seguido de acento separado pode virar o único caractere é.
    decodedSlug = decodeURIComponent(slug).normalize("NFC");
  } catch {
    return null;
  }

  // Barra e contrabarra delimitam caminhos. Um % restante indica que ainda
  // há texto escapado ou um símbolo que preferimos omitir desta sugestão.
  if (INVALID_TEXT_CHARACTERS.test(decodedSlug) || /[/\\%]/.test(decodedSlug)) return null;

  // 3. TRANSFORMAR O SLUG EM PALAVRAS PARA O FORMULÁRIO
  const name = decodedSlug.replace(/[-_\s]+/g, " ").trim();
  if (name.length > MAX_SUGGESTION_LENGTH) return null;

  const words = name.split(" ");
  // some retorna true se alguma palavra tiver pelo menos duas letras e
  // somente letras. Isso deixa identificadores isolados como "AB123" de fora.
  const hasReadableWord = words.some((word) => /^\p{L}{2,}$/u.test(word));
  if (!hasReadableWord) return null;

  if (name !== name.toLocaleLowerCase("pt-BR")) return name;
  // Se o slug veio todo em minúsculas, só ajustamos a primeira letra de cada
  // palavra. Acentos e palavras de outros idiomas continuam como no link.
  const capitalizedWords = words.map((word) =>
    word.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("pt-BR")));
  const suggestion = capitalizedWords.join(" ");
  // A capitalização pode aumentar o tamanho de uma palavra, como ß → SS.
  return suggestion.length <= MAX_SUGGESTION_LENGTH ? suggestion : null;
}

function parseHttpsUrl(text: string, base?: string): URL | null {
  // new URL pode normalizar contrabarras e remover controles do texto.
  // Rejeitamos esses caracteres antes de interpretar o endereço recebido.
  if (INVALID_TEXT_CHARACTERS.test(text) || text.includes("\\")) return null;
  try {
    const url = new URL(text, base);
    // URL deixa port vazio para a porta padrão. Credenciais ficam em campos
    // separados do host e precisam ser conferidas mesmo com origem igual.
    const usesStandardHttps = url.protocol === "https:" && url.port === "";
    const hasCredentials = url.username !== "" || url.password !== "";
    if (!usesStandardHttps || hasCredentials) return null;
    return url;
  } catch {
    return null;
  }
}

function readProductSlug(page: URL): string | null {
  const path = page.pathname.replace(/\/$/, "");
  // ^ e $ exigem o formato no caminho inteiro. O grupo ([^/]+) captura o
  // nome em um único segmento. \d representa dígito, e \. um ponto literal.
  // exec devolve null se não casar. Com ?.[1] lemos o primeiro grupo apenas
  // quando há resultado, e ?? null dá a mesma saída de ausência em cada caso.
  switch (page.hostname) {
    case "br.shein.com":
      return /^\/([^/]+)-p-\d+\.html$/.exec(path)?.[1] ?? null;
    case "www.nike.com.br":
    case "nike.com.br":
      return /^\/([^/]+)-\d{6}\.html$/.exec(path)?.[1] ?? null;
    case "shopee.com.br":
      return /^\/([^/]+)-i\.\d+\.\d+$/.exec(path)?.[1] ?? null;
    default:
      return null;
  }
}
