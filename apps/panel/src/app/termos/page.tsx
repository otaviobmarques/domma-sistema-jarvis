export const metadata = { title: "Termos de Uso · Jarvis" };

export default function Termos() {
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold">Termos de Uso — Jarvis</h1>
      <p className="muted">Domma Tecnologia · última atualização: 08/11/2026</p>

      <p>
        O Jarvis é um assistente de inteligência artificial de uso interno, disponibilizado pela Domma Tecnologia aos seus colaboradores e às empresas do grupo. Ao usar o
        Jarvis, você concorda com estes termos.
      </p>

      <h2 className="font-semibold text-lg">1. Acesso</h2>
      <p>O acesso é restrito a usuários cadastrados pelo administrador. Cada usuário é responsável pelas ações realizadas com suas credenciais, PIN e número de WhatsApp.</p>

      <h2 className="font-semibold text-lg">2. Uso adequado</h2>
      <p>
        O Jarvis deve ser usado apenas para atividades de trabalho legítimas. É proibido usá-lo para enviar mensagens indesejadas, acessar dados sem autorização ou
        descumprir a legislação, em especial a LGPD.
      </p>

      <h2 className="font-semibold text-lg">3. Respostas da IA</h2>
      <p>
        As respostas são geradas por inteligência artificial e podem conter erros. Ações sensíveis exigem confirmação do usuário, que é responsável por revisar o que aprova.
      </p>

      <h2 className="font-semibold text-lg">4. Privacidade</h2>
      <p>
        O tratamento de dados segue a nossa <a className="underline" href="/privacidade">Política de Privacidade</a>.
      </p>

      <h2 className="font-semibold text-lg">5. Contato</h2>
      <p>Domma Tecnologia — otaviobmarques@gmail.com</p>
    </main>
  );
}
