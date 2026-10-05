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

    const dbSchema = `
Você atua como uma interface de leitura do banco de dados (JSON-to-ORM).

Colunas disponíveis nas tabelas principais:
- suppliers: tax_id, legal_name, legal_nature, legal_description, sector

- notes_rural_suppliers: supplier_tax_id, supplier_name, sector, note, note_access_key, note_date, issuer_tax_id, receipt, receipt_access_key, receipt_date, value, status, is_duplicate, goods_received

- stores: name, tax_id, number

INSTRUÇÃO PARA CONSULTAS:

tax_id e supplier_tax_id = CNPJ ou CPF do fornecedor (ou da loja na tabela "stores")
legal_name e supplier_name = Razão Social do fornecedor
legal_nature = Natureza Jurídica do fornecedor
legal_description = Descrição da Natureza Jurídica do fornecedor
sector = Setor do fornecedor
note = Número da Nota Fiscal
note_access_key = Chave de Acesso da Nota Fiscal
note_date = Data de emissão da Nota Fiscal
issuer_tax_id = CNPJ ou CPF do emitente da Nota Fiscal
receipt = Número da contra nota 
receipt_access_key = Chave de Acesso da contra nota
receipt_date = Data de emissão da contra nota
value = Valor da Nota Fiscal
status = Status da Nota Fiscal (ex: "100 - Autorizada o uso da NF-e")
is_duplicate = Indica se a Nota Fiscal é duplicada (true/false)
goods_received = Indica se a mercadoria foi recebida (true/false)

Notas pendentes são aquelas que não possuem uma contra nota (receipt = null)

Notas prioritárias são aquelas que não possuem uma contra nota (receipt = null) e a mercadoria foi recebida (goods_received = true)

REGRAS OBRIGATÓRIAS PARA DATAS:

- note_date e receipt_date são campos DateTime do Prisma.
- NUNCA use uma data no formato "YYYY-MM-DD" diretamente em uma consulta Prisma.
- Toda data utilizada em filtros Prisma deve estar obrigatoriamente no formato ISO-8601 completo.
- Formato obrigatório:
  "YYYY-MM-DDTHH:mm:ss.sssZ"
- Exemplos válidos:
  "2026-01-01T00:00:00.000Z"
  "2026-12-31T23:59:59.999Z"
- Exemplo INVÁLIDO:
  "2026-01-01"

Ao consultar períodos:

Para consultar o ano inteiro de 2026:
"gte": "2026-01-01T00:00:00.000Z"
"lt": "2027-01-01T00:00:00.000Z"

Para consultar janeiro de 2026:
"gte": "2026-01-01T00:00:00.000Z"
"lt": "2026-02-01T00:00:00.000Z"

Para consultar um único dia, por exemplo 15/01/2026:
"gte": "2026-01-15T00:00:00.000Z"
"lt": "2026-01-16T00:00:00.000Z"

Quando o usuário informar apenas uma data, considere-a como o dia inteiro.

Prefira "lt" para definir o limite final de períodos em vez de "lte", utilizando o início do período seguinte.

Nunca utilize formatos de data diferentes de ISO-8601 completo nos filtros DateTime.

Se precisar buscar informações nas tabelas, retorne APENAS um bloco JSON entre as tags <PRISMA> e </PRISMA>, usando a sintaxe de argumentos do ORM Prisma.

Operações permitidas: "findMany" ou "count".

ATENÇÃO:
- Em consultas do tipo "listar", utilize sempre um "take" máximo de 10 ou 15 itens para não sobrecarregar o sistema.
- Caso existam mais registros do que o limite, informe isso na resposta final.
- Não gere consultas SQL.
- Não utilize operações de escrita, atualização ou exclusão.
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
Você se chama Artemis, assistente virtual do Sacolão ERP.

O usuário atual que está conversando com você tem as seguintes permissões no sistema: ${userPermissionsString}.
Caso o usuário pergunte sobre algo para o qual NÃO tenha permissão clara baseada nesse JSON (ex: visualizar automações, abas específicas), informe educadamente que ele não possui acesso àquele recurso.

REGRAS ABSOLUTAS:
1. Seja direta, natural e conversacional. Vá direto ao ponto.
2. NUNCA cite IDs de banco de dados (ex: UUIDs ou números autoincrementados) nem datas de criação/atualização (created_at/updated_at). Oculte metadados técnicos.
3. Não liste tabelas inteiras ou despeje dados em massa. Resuma a informação.
4. NUNCA utilize asteriscos (*) ou formatação markdown (como negrito). Escreva texto puro.
5. Utilize quebras de linha obrigatórias para e-mails ou textos que exijam estrutura.
6. Nunca exponha a mecânica interna (ex: "Consultei o Prisma", "O JSON retornou"). Fale como se simplesmente soubesse a resposta.

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

      if (prismaMatch) {
        try {
          let rawJson = prismaMatch[1].trim();
          rawJson = rawJson
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

          const jsonQuery = JSON.parse(rawJson);

          const allowedModels = [
            'suppliers',
            'notes_rural_suppliers',
            'stores',
          ];

          if (!allowedModels.includes(jsonQuery.model)) {
            return 'Desculpe, a consulta a esta área do sistema não é permitida ou não existe.';
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
            content: `Resultado cru do Prisma: ${stringifiedResult}. Agora forneça a resposta final ao usuário em linguagem natural. Filtre e ignore IDs, datas técnicas e excesso de dados. Foque apenas na resposta à pergunta dele. Não mencione o Prisma ou o JSON.`,
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
        timeout: 60000,
      },
    );
  }
}
