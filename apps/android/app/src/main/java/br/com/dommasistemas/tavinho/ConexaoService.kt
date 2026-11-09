package br.com.dommasistemas.tavinho

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject

/**
 * Serviço em primeiro plano: mantém a conexão com o cérebro (long-polling) e
 * executa as ações pedidas no celular. Mostra a notificação fixa exigida pelo
 * Android, com o botão "Parar tudo".
 */
class ConexaoService : Service() {
    private val escopo = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var laco: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACAO_PARAR) {
            escopo.launch {
                Acoes.PARAR = true
                runCatching { TavinhoApp.instancia.api().post("/device/panic") }
                Estado.mensagem.value = "⛔ Parei tudo."
            }
            return START_STICKY
        }
        val n = notificacao("Tavinho ativo", "Pronto para seus pedidos")
        if (Build.VERSION.SDK_INT >= 34) {
            ServiceCompat.startForeground(this, ID_ATIVO, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(ID_ATIVO, n)
        }
        if (laco?.isActive != true) laco = escopo.launch { conectar() }
        return START_STICKY
    }

    private suspend fun conectar() {
        var primeira = true
        while (escopo.isActive) {
            val cfg = TavinhoApp.instancia.config
            if (!cfg.pareado) {
                Estado.conexao.value = "desconectado"
                delay(3000)
                continue
            }
            try {
                val corpo = JSONObject()
                if (primeira) corpo.put("info", JSONObject().put("os", "Android ${Build.VERSION.RELEASE}").put("versao_app", BuildConfig.VERSION_NAME).put("modelo", cfg.nomeAparelho))
                val r = TavinhoApp.instancia.api().post("/device/poll", corpo, timeoutS = 40)
                primeira = false
                Estado.conexao.value = "online"
                val acao = r.optJSONObject("acao") ?: continue
                executando(acao)
                val res = Acoes.executar(this, acao)
                TavinhoApp.instancia.api().post("/device/result", res)
                terminou()
            } catch (e: ErroApi) {
                if (e.status == 401) {
                    cfg.desparear()
                    Estado.conexao.value = "desconectado"
                } else {
                    Estado.conexao.value = "offline"
                    primeira = true
                    delay(5000)
                }
            } catch (e: Exception) {
                Estado.conexao.value = "offline"
                primeira = true
                delay(5000)
            }
        }
    }

    private fun executando(acao: JSONObject) {
        val desc = Acoes.descrever(acao)
        Estado.acaoAtual.value = desc
        getSystemService(NotificationManager::class.java)
            .notify(ID_EXECUTANDO, notificacao("Tavinho executando", desc, canal = TavinhoApp.CANAL_EXECUTANDO))
    }

    private fun terminou() {
        Estado.acaoAtual.value = null
        getSystemService(NotificationManager::class.java).cancel(ID_EXECUTANDO)
    }

    private fun notificacao(titulo: String, texto: String, canal: String = TavinhoApp.CANAL_ATIVO): Notification {
        val abrir = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val parar = PendingIntent.getService(this, 1, Intent(this, ConexaoService::class.java).setAction(ACAO_PARAR), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, canal)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setOngoing(true)
            .setContentIntent(abrir)
            .addAction(0, "⛔ Parar tudo", parar)
            .setColor(0xFF6F5CF6.toInt())
            .build()
    }

    override fun onDestroy() {
        escopo.cancel()
        super.onDestroy()
    }

    companion object {
        const val ACAO_PARAR = "parar"
        const val ID_ATIVO = 1
        const val ID_EXECUTANDO = 2

        fun iniciar(ctx: Context) {
            ctx.startForegroundService(Intent(ctx, ConexaoService::class.java))
        }
    }
}

/** Estado observado pela tela. */
object Estado {
    val conexao = MutableStateFlow("conectando")
    val acaoAtual = MutableStateFlow<String?>(null)
    val mensagem = MutableStateFlow<String?>(null)
}
