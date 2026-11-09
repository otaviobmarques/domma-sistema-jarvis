package br.com.dommasistemas.tavinho

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class TavinhoApp : Application() {
    lateinit var config: Config
        private set

    override fun onCreate() {
        super.onCreate()
        instancia = this
        config = Config(this)
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CANAL_ATIVO, "Tavinho ativo", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Mantém o Tavinho conectado para executar seus pedidos"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CANAL_EXECUTANDO, "Tavinho executando", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Aparece enquanto o Tavinho age no celular, com botão de parar"
            },
        )
    }

    fun api() = Api(config.servidor, config.token)

    companion object {
        const val CANAL_ATIVO = "ativo"
        const val CANAL_EXECUTANDO = "executando"
        lateinit var instancia: TavinhoApp
            private set
    }
}
