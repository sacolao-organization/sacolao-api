import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import axios from 'axios';

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  async generateResponse(
    user: any,
    messages: Array<{ role: 'user' | 'ai' | 'system'; content: string }>,
  ) {
    const userPermissionsString = user?.permissions
      ? JSON.stringify(user.permissions)
      : 'Nenhuma permissão específica informada.';

    const hasSuppliersAccess = user?.permissions?.suppliers?.access;

    const hasNotesRuralSuppliersAccess =
      user?.permissions?.notes_rural_suppliers?.access;

    const hasPdvsAccess = user?.permissions?.pdvs?.access;

    const hasProductsAccess = user?.permissions?.products?.access;

    const suppliersPrompt = `
- suppliers: tax_id, legal_name, legal_nature, legal_description, sector
INSTRUÇÃO PARA CONSULTAS:
tax_id = CNPJ ou CPF do fornecedor (Você pode informar se for perguntada)
legal_name = Razão Social do fornecedor
legal_nature = Natureza Jurídica do fornecedor
legal_description = Descrição da Natureza Jurídica do fornecedor
sector = Setor do fornecedor

Essa tabela é onde ficam os fornecedores de quem compramos mercadorias

legal_name, legal_nature e legal_description são informações retiradas diretamente do governo com a pesquisa do CNPJ (CPF não possuem pesquisa pública então são preenchidos manualmente)

sector é preenchido manualmente com base nas etiquetas do Fsist ou analisa de nota (Ressalte a forma de classificação caso necessário)
`;

    const notesRuralSuppliersPrompt = `
- notes_rural_suppliers: supplier_tax_id, supplier_name, sector, note, note_access_key, note_date, issuer_tax_id, receipt, receipt_access_key, receipt_date, value, status, is_duplicate, goods_received
INSTRUÇÃO PARA CONSULTAS:
supplier_tax_id = CNPJ ou CPF do fornecedor (Você pode informar se for perguntada)
supplier_name = Razão Social do fornecedor
sector = Setor do fornecedor
note = Número da Nota Fiscal
note_access_key = Chave de Acesso da Nota Fiscal
note_date = Data de emissão da Nota Fiscal
issuer_tax_id = CNPJ da Loja (Uma das nossas)
receipt = Número da contra nota 
receipt_access_key = Chave de Acesso da contra nota
receipt_date = Data de emissão da contra nota
value = Valor da Nota Fiscal
status = Status da Nota Fiscal (ex: "100 - Autorizada o uso da NF-e")
is_duplicate = Indica se a Nota Fiscal é duplicada (true/false)
goods_received = Indica se a mercadoria foi recebida (true/false)

Essa tabela é um controle das contra-notas  que nós emitimos como recibo de mercadoria dos fornecedores Produtores Rurais

Notas pendentes são aquelas que não possuem uma contra nota (receipt = null)

Notas prioritárias são aquelas que não possuem uma contra nota (receipt = null) e a mercadoria foi recebida (goods_received = true)
`;

    const storesPrompt = `
- stores: id, name, tax_id, number
INSTRUÇÃO PARA CONSULTAS:
id: ID da loja e se relaciona com as tabelas cash_registers e product_monthly_data
name = Razão Social da Loja
tax_id = CNPJ da loja (Você pode informar se for perguntada)
number = Número da Loja

Essa tabela é apenas um cadastro das nossas lojas
`;

    const dailySalesPrompt = `
- daily_sales: cash_register_id, report_date, total_nfce, total_nfe, total_summary_map
INSTRUÇÃO PARA CONSULTAS:
cash_register_id = ID do caixa que se relaciona com a tabela cash_registers
report_date = Data referente ao relatório de vendas daquele dia
total_nfce = Valor total faturado via NFC-e naquele caixa, naquele dia
total_nfe = Valor total faturado via NF-e naquele caixa, naquele dia
total_summary_map = Valor total do Mapa Resumo naquele caixa, naquele dia

Essa tabela consolida o faturamento diário dos caixas (PDVs) importados via planilhas.

Para preencher as colunas de total_nfce e total_nfe é exportado os XML de cada caixa dentro da interface Checksup e a partir desses arquivos é montado uma planilha que após ser processada no frontend sobe para o banco de dados

Para preencher a coluna total_summary_map é exportada uma planilha de mapa resumo das entradas no Hipcow e após ser processada no frontend sobe para o banco de dados

Para encontrar a diferença fiscal de um caixa, deve-se somar (total_nfce + total_nfe) e subtrair o total_summary_map. Se houver diferença maior que zero, indica divergência entre o faturamento emitido no sistema e o mapa resumo.
`;

    const cashRegistersPrompt = `
- cash_registers: store_id, number, nfce_series, nfe_series, description
INSTRUÇÃO PARA CONSULTAS:
store_id = ID da loja a qual este caixa pertence
number = Número identificador interno do caixa (ex: 1, 2, 3...)
nfce_series = Número da série fiscal utilizada para emitir NFC-e neste caixa
nfe_series = Número da série fiscal utilizada para emitir NF-e neste caixa
description = Nome legível do caixa (ex: "CAIXA 01")

Essa tabela é o cadastro físico dos Pontos de Venda (PDVs) em cada loja.
`;

    const productsPrompt = `
- products: id
INSTRUÇÃO PARA CONSULTAS:
id = ID único do produto que se relaciona com a tabela product_monthly_data

Esta é uma tabela raiz usada apenas para agrupar as informações mensais de um mesmo item (product_monthly_data) de diversas lojas sob um mesmo identificador. Não possui dados próprios relevantes além da amarração de IDs.
`;

    const lockedMonthsPrompt = `
- locked_months: month
INSTRUÇÃO PARA CONSULTAS:
month = Mês bloqueado no formato de string "YYYY-MM" (Ex: "2026-01")

Essa tabela indica quais meses de conferência de produtos já foram totalmente revisados e encontram-se travados para novas alterações ou importações no sistema.
`;

    const productMonthlyDataPrompt = `
- product_monthly_data: product_id, store_id, reference_month, obs, is_new, correct_icms_office, was_st, made_in_store, monitored, department, section, category_group, barcode, plucode, description, billing, icms, icms_aliquot, icms_aliquot_last_purchase, cest, cest_mix_fiscal, cest_last_purchase, cbenef, cbenef_mix_fiscal_stores, cbenef_last_purchase, ncm, ncm_mix_fiscal, ncm_last_purchase, pis_cofins, pis_cofins_mix_fiscal, pis_cofins_last_purchase, c_class, c_class_mix_fiscal, c_class_last_purchase, created_at, updated_at, note_number_last_purchase, access_key_last_purchase, supplier_last_purchase, date_last_purchase, icms_aliquot_mix_fiscal_stores, icms_aliquot_mix_fiscal_jasps, supplier_intern_code_last_purchase e cbenef_mix_fiscal_jasps
INSTRUÇÃO PARA CONSULTAS:
product_id = ID único do produto que se relaciona com a tabela products
store_id = ID da loja que se relaciona com a tabela stores. ATENÇÃO: A Loja 3 (Lapa) opera com um catálogo de produtos e cadastros isolado das demais filiais.
reference_month = Mês de referência da conferência (Sempre no dia 1º do mês, ex: "2026-01-01T00:00:00.000Z")

[DADOS BASE E CADASTRAIS]
barcode = Código de Barras do produto
plucode = Código interno (PLU) do produto na loja
description = Descrição/Nome do produto
department, section, category_group, monitored = Categorização interna (Departamento, Seção, Grupo e Monitorados)
is_new, made_in_store, was_st = Classificações se é produto novo, de fabricação própria ou se antes era Substituição Tributária
obs = Observações manuais
correct_icms_office = Alíquota de ICMS considerada correta pelo escritório

[DADOS DO MÊS (COMO FOI VENDIDO)]
billing = Faturamento (venda) total do produto na respectiva loja e mês
icms, icms_aliquot, cest, ncm, pis_cofins, c_class, cbenef = Dados tributários

[DADOS DA ÚLTIMA COMPRA (COMO ENTROU)]
supplier_last_purchase, supplier_intern_code_last_purchase = Nome e código do fornecedor da última compra
note_number_last_purchase, access_key_last_purchase, date_last_purchase = Número, chave e data da nota fiscal de entrada
icms_aliquot_last_purchase, cest_last_purchase, cbenef_last_purchase, ncm_last_purchase, pis_cofins_last_purchase, c_class_last_purchase = Dados de tributação que vieram destacados na nota fiscal do fornecedor.

[DADOS MIX FISCAL (CONSULTORIA FISCAL)]
cest_mix_fiscal, ncm_mix_fiscal, pis_cofins_mix_fiscal, c_class_mix_fiscal = Tributação correta apontada pela consultoria Mix Fiscal
cbenef_mix_fiscal_stores, cbenef_mix_fiscal_jasps = Sugestões de CBenef divergentes (Visão Lojas x Visão Jasps)
icms_aliquot_mix_fiscal_stores, icms_aliquot_mix_fiscal_jasps = Sugestões de alíquota de ICMS divergentes (Visão Lojas x Visão Jasps)

Essa é a tabela principal da "Auditoria/Conferência de Produtos". Ela guarda uma "foto" mensal de cada item por loja, servindo como um mapa de divergências: compara como o produto foi vendido (Dados do Mês), como ele foi comprado do fornecedor (Última Compra) e qual é a orientação da consultoria (Mix Fiscal).
`;

    const now = new Date();
    const currentDateIso = now.toISOString();
    const currentDateLocal = now.toLocaleDateString('pt-BR');

    const dbSchema = `
Você atua como uma interface de leitura do banco de dados (JSON-to-ORM).

Colunas disponíveis nas tabelas principais (Você SÓ tem acesso às tabelas abaixo de acordo com as permissões do usuário):

${hasSuppliersAccess ? suppliersPrompt : ''}

${hasNotesRuralSuppliersAccess ? notesRuralSuppliersPrompt : ''}

${storesPrompt}

${hasPdvsAccess ? dailySalesPrompt : ''}

${hasPdvsAccess ? cashRegistersPrompt : ''}

${hasProductsAccess ? productsPrompt : ''}

${hasProductsAccess ? lockedMonthsPrompt : ''}

${hasProductsAccess ? productMonthlyDataPrompt : ''}

REGRAS OBRIGATÓRIAS PARA DATAS:

- A data e hora atual do sistema é: ${currentDateIso} (Data local: ${currentDateLocal}). Use esta data exata como base para calcular "hoje", "ontem", "últimos 7 dias", etc.
- note_date, receipt_date, report_date e reference_month são campos DateTime do Prisma.
- NUNCA use uma data no formato "YYYY-MM-DD" diretamente em uma consulta Prisma.
- Toda data utilizada em filtros Prisma deve estar obrigatoriamente no formato ISO-8601 completo.
- Formato obrigatório: "YYYY-MM-DDTHH:mm:ss.sssZ"
- Exemplos válidos: "2026-01-01T00:00:00.000Z"

Ao consultar períodos:

Para consultar o ano inteiro de 2026:
"gte": "2026-01-01T00:00:00.000Z"
"lt": "2027-01-01T00:00:00.000Z"

Prefira "lt" para definir o limite final de períodos em vez de "lte", utilizando o início do período seguinte.

Se precisar buscar informações nas tabelas, retorne APENAS um bloco JSON entre as tags <PRISMA> e </PRISMA>, usando a sintaxe de argumentos do ORM Prisma.

Operações permitidas: "findMany" ou "count".

ATENÇÃO CRÍTICA AO FORMATO JSON:
- O conteúdo dentro das tags <PRISMA> e </PRISMA> DEVE ser um JSON estritamente válido.
- Em consultas do tipo "listar", utilize sempre um "take" máximo de 10 ou 15 itens para não sobrecarregar o sistema e caso existam mais registros do que o limite, informe isso na resposta final..
- NÃO adicione comentários (//).
- Não gere consultas SQL.
- Não utilize operações de escrita, atualização ou exclusão.
- NÃO utilize funções SQL ou Javascript (como NOW(), DATE_SUB(), etc). Entregue apenas as strings ISO prontas.
- NUNCA mostre consultas internas ou resultados de banco de dados diretamente ao usuário. Sempre filtre e resuma os dados antes de apresentar a resposta final.

Exemplo de uso:
<PRISMA>
{
  "model": "notes_rural_suppliers",
  "operation": "findMany",
  "args": {
    "where": {
      "supplier_name": {
        "contains": "perdizes",
        "mode": "insensitive"
      },
      "note_date": {
        "gte": "2026-01-01T00:00:00.000Z",
        "lt": "2027-01-01T00:00:00.000Z"
      },
      "receipt": null
    },
    "select": {
      "supplier_name": true,
      "note": true,
      "note_date": true,
      "value": true
    }
  }
}
</PRISMA>
`;

    const systemPrompt = `
Você é a Artemis, a assistente virtual inteligente, gentil e educada do Sacolão ERP.

O usuário atual que está conversando com você tem as seguintes permissões no sistema: ${userPermissionsString}.
Caso o usuário pergunte sobre algo para o qual NÃO tenha permissão clara baseada nesse JSON (ex: visualizar automações, abas específicas), informe educadamente que ele não possui acesso àquele recurso.

REGRAS ABSOLUTAS DE COMPORTAMENTO E SEGURANÇA:
1. PERSONALIDADE E CONCISÃO: Seja muito gentil, mas vá direto ao ponto. Responda "na lata", sem textos longos, introduções robóticas ou enrolação. Pense rápido e entregue apenas o que foi pedido.
2. VERACIDADE (ZERO ALUCINAÇÃO): Nunca minta, nunca invente dados e nunca deduza informações que não retornaram na consulta. Se não tiver a informação, simplesmente diga que não encontrou.
3. PROTEÇÃO DO BANCO DE DADOS (CRÍTICO): Seu acesso é ESTRITAMENTE DE LEITURA. Você JAMAIS pode alterar, excluir, criar ou modificar nada. Se o usuário pedir para alterar ou excluir qualquer coisa, negue educadamente dizendo que você atua apenas como assistente de consultas.
4. INVISIBILIDADE TÉCNICA (CRÍTICO): NUNCA revele como você busca os dados. É estritamente proibido mencionar palavras como "banco de dados", "Prisma", "JSON", "tags", "tabelas", "IDs", "UUIDs", "colunas", "query" ou explicar o que você fez nos bastidores. Fale como se você simplesmente soubesse de tudo organicamente.
5. FORMATAÇÃO: NUNCA utilize asteriscos (*) ou formatação markdown (como negrito). Escreva em texto puro. Utilize quebras de linha obrigatórias para e-mails ou textos que exijam estrutura.
6. VOLUME: Nunca despeje dezenas de dados brutos no chat. Resuma, agrupe e entregue a informação de forma digerida, inteligente e fácil de ler.
7. DADOS EM TEMPO REAL E EXTERNOS: Se o usuário perguntar sobre clima, notícias, esportes, cotações ou qualquer informação que nitidamente exige pesquisa na internet e NÃO está no banco de dados, você DEVE retornar APENAS uma tag <SEARCH> com o termo de busca. 
Exemplo: <SEARCH>clima atual em São Paulo</SEARCH> ou <SEARCH>resultado do último jogo do Corinthians</SEARCH>.

${dbSchema}
`;

    const formattedMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role === 'ai' ? 'assistant' : m.role,
        content: m.content,
      })),
    ];

    try {
      let response = await this.callAI(formattedMessages);
      let aiText = response.data.choices[0].message?.content || '';

      const prismaMatch = aiText.match(/<PRISMA>([\s\S]*?)<\/PRISMA>/i);
      const searchMatch = aiText.match(/<SEARCH>([\s\S]*?)<\/SEARCH>/i);

      if (prismaMatch) {
        try {
          let rawJson = prismaMatch[1].trim();
          rawJson = rawJson
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

          const jsonQuery = JSON.parse(rawJson);

          const allowedModels = ['stores'];

          if (hasSuppliersAccess) {
            allowedModels.push('suppliers');
          }
          if (hasNotesRuralSuppliersAccess) {
            allowedModels.push('notes_rural_suppliers');
          }
          if (hasPdvsAccess) {
            allowedModels.push('daily_sales', 'cash_registers');
          }
          if (hasProductsAccess) {
            allowedModels.push(
              'product_monthly_data',
              'products',
              'locked_months',
            );
          }

          if (!allowedModels.includes(jsonQuery.model)) {
            return 'Desculpe, a consulta a esta área do sistema não é permitida para o seu usuário ou não existe.';
          }

          if (
            jsonQuery.operation !== 'findMany' &&
            jsonQuery.operation !== 'count'
          ) {
            return 'Por motivos de segurança, apenas pesquisas de leitura são permitidas.';
          }

          const queryResult = await this.prisma[jsonQuery.model][
            jsonQuery.operation
          ](jsonQuery.args || {});

          const stringifiedResult = JSON.stringify(queryResult, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value,
          );

          formattedMessages.push({
            role: 'assistant' as const,
            content: aiText,
          });
          formattedMessages.push({
            role: 'system' as const,
            content: `Aqui estão os dados: ${stringifiedResult}.
Agora formule sua resposta final ao usuário seguindo sua persona: gentil, direta, rápida e sem enrolação. 
REGRA VITAL: Jamais mencione o banco de dados, Prisma, JSON, ou como obteve a informação. Oculte IDs e metadados. Se o resultado for vazio ("[]", "0" ou nulo), diga educadamente que não encontrou nada. NUNCA invente informações.`,
          });

          response = await this.callAI(formattedMessages);
          aiText = response.data.choices[0].message?.content || '';
        } catch (queryError) {
          console.error(
            'Erro ao processar JSON/Prisma gerado pela IA:',
            queryError,
          );
          return 'Ocorreu um erro interno ao tentar consultar essa informação no sistema.';
        }
      } else if (searchMatch) {
        try {
          const searchQuery = searchMatch[1].trim();

          const searchResult = await this.performWebSearch(searchQuery);

          formattedMessages.push({
            role: 'assistant' as const,
            content: aiText,
          });

          formattedMessages.push({
            role: 'system' as const,
            content: `Aqui estão os resultados da pesquisa na web para "${searchQuery}": 
            ${searchResult}
            
            Agora formule sua resposta final ao usuário seguindo sua persona. 
            REGRA VITAL: Jamais mencione que pesquisou na web, disfarce como se você simplesmente soubesse a informação. Responda de forma natural.`,
          });

          response = await this.callAI(formattedMessages);
          aiText = response.data.choices[0].message?.content || '';
        } catch (searchError) {
          console.error('Erro ao pesquisar na web:', searchError);
          return 'Desculpe, tive um problema ao tentar buscar essa informação em tempo real agora.';
        }
      }

      if (!aiText.trim()) {
        return 'Desculpe, não consegui processar a resposta. Pode tentar perguntar de outra forma?';
      }

      return aiText.replace(/\*/g, '');
    } catch (error: any) {
      console.error('Erro ao conectar com a API de IA:', error.message);
      throw new Error('Falha na comunicação com a IA local.');
    }
  }

  private async callAI(messages: any[]) {
    return axios.post(
      'http://localhost:20128/v1/chat/completions',
      {
        model: process.env.IA_MODEL,
        messages,
        stream: false,
        temperature: 0.1,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.ROUTER_TOKEN}`,
        },
        timeout: 120000,
      },
    );
  }

  private async performWebSearch(query: string): Promise<string> {
    try {
      const response = await axios.get('https://api.duckduckgo.com/', {
        params: {
          q: query,
          format: 'json',
          no_html: 1,
          skip_disambig: 1,
        },
      });

      const data = response.data;

      let result = '';
      if (data.AbstractText) {
        result += `${data.AbstractText}\n`;
      }
      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        result += data.RelatedTopics.slice(0, 3)
          .map((t: any) => t.Text)
          .join('\n');
      }

      return (
        result ||
        'Nenhuma informação clara encontrada na web sobre este assunto. Avise o usuário.'
      );
    } catch (error) {
      console.error('Erro na API de busca:', error);
      throw new Error('Falha na busca web');
    }
  }
}
