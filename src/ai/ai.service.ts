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
Se precisar buscar informações nas tabelas, retorne APENAS um bloco JSON entre as tags <PRISMA> e </PRISMA>, usando a sintaxe de argumentos do ORM Prisma.
Operações: "findMany" ou "count".
Não gere consultas SQL.

Exemplo de uso:
<PRISMA>
{
  "model": "notes_rural_suppliers",
  "operation": "count",
  "args": {
    "where": {
      "receipt": null,
      "supplier_name": { "contains": "perdizes", "mode": "insensitive" }
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
      let aiText = response.data.choices[0].message.content;

      const prismaMatch = aiText.match(/<PRISMA>([\s\S]*?)<\/PRISMA>/i);

      if (prismaMatch) {
        try {
          const jsonQuery = JSON.parse(prismaMatch[1].trim());

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

          if (jsonQuery.model === 'users') {
            if (!jsonQuery.args) jsonQuery.args = {};
            if (jsonQuery.args.select) {
              delete jsonQuery.args.select.password_hash;
              delete jsonQuery.args.select.id;
              delete jsonQuery.args.select.created_at;
            } else {
              jsonQuery.args.select = {
                username: true,
              };
            }
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
          aiText = response.data.choices[0].message.content;
        } catch (queryError) {
          console.error(
            'Erro ao processar JSON/Prisma gerado pela IA:',
            queryError,
          );
          return 'Ocorreu um erro interno ao tentar consultar essa informação no sistema.';
        }
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
        model: 'oc/mimo-v2.5-free',
        messages,
        stream: false,
        temperature: 0.1,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.ROUTER_TOKEN}`,
        },
        timeout: 25000,
      },
    );
  }
}
