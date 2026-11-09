package br.com.dommasistemas.tavinho

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Liga o Tavinho quando o celular reinicia. */
class AoLigar : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && TavinhoApp.instancia.config.pareado) {
            runCatching { ConexaoService.iniciar(ctx) }
        }
    }
}
