export const metadata = { title: "Termos de Uso · Tavinho" };

export default function Termos() {
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold">Termos de Uso — Tavinho</h1>
      <p className="muted">Domma Tecnologia · última atualização: 08/11/2026</p>

      <p>
        O Tavinho é um assistente de inteligência artificial oferecido pela Domma Tecnologia às empresas que o contratam (clientes) e às pessoas que elas cadastram. Ao usar o
        Tavinho, você concorda com estes termos.
      </p>

      <h2 className="font-semibold text-lg">1. Acesso</h2>
      <p>O acesso é restrito a usuários cadastrados pelo responsável pela conta do cliente. Cada usuário é responsável pelas ações realizadas com suas credenciais, PIN e número de WhatsApp. Cada cliente tem um ambiente separado: os dados de uma empresa não são visíveis para outra.</p>

      <h2 className="font-semibold text-lg">2. Uso adequado</h2>
      <p>
        O Tavinho deve ser usado apenas para atividades de trabalho legítimas. É proibido usá-lo para enviar mensagens indesejadas, acessar dados sem autorização ou
        descumprir a legislação, em especial a LGPD.
      </p>

      <h2 className="font-semibold text-lg">3. Respostas da IA</h2>
      <p>
        As respostas são geradas por inteligência artificial e podem conter erros. Ações sensíveis exigem confirmação do usuário, que é responsável por revisar o que aprova.
      </p>

      <h2 className="font-semibold text-lg">4. Assinatura e pagamento</h2>
      <p>
        Novas contas têm um período de teste grátis. Depois dele, a cobrança é mensal, por usuário ativo, pelo valor exibido no cadastro e na página Assinatura, e o valor se
        ajusta quando usuários são ativados ou desativados. O pagamento é processado pelo Asaas (Pix, boleto ou cartão). Cada plano inclui uma franquia mensal de uso de IA;
        ao atingi-la, o assistente pausa até o mês seguinte ou até a franquia ser ampliada. Faturas em atraso podem levar à suspensão do serviço após o prazo de tolerância. O
        cliente pode cancelar a qualquer momento, sem multa; o serviço segue até o fim do período já pago.
      </p>

      <h2 className="font-semibold text-lg">5. Privacidade</h2>
      <p>
        O tratamento de dados segue a nossa <a className="underline" href="/privacidade">Política de Privacidade</a>.
      </p>

      <h2 className="font-semibold text-lg">6. Contato</h2>
      <p>Domma Tecnologia — otaviobmarques@gmail.com</p>
    </main>
  );
}
