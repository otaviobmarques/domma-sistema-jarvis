package br.com.dommasistemas.tavinho

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.concurrent.ConcurrentLinkedDeque

/** Guarda as últimas notificações para o Tavinho resumir ("o que chegou de importante?"). */
class TavinhoNotificacoes : NotificationListenerService() {
    data class Item(val app: String, val titulo: String, val texto: String, val quando: Long)

    override fun onListenerConnected() {
        ativo = true
        runCatching { activeNotifications?.forEach { guardar(it) } }
    }

    override fun onListenerDisconnected() {
        ativo = false
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) = guardar(sbn)

    private fun guardar(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName || sbn.isOngoing) return
        val ex = sbn.notification.extras
        val titulo = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val texto = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: ""
        if (titulo.isBlank() && texto.isBlank()) return
        val app = runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString() }.getOrDefault(sbn.packageName)
        itens.addFirst(Item(app, titulo, texto.take(500), sbn.postTime))
        while (itens.size > 80) itens.removeLast()
    }

    companion object {
        @Volatile var ativo = false
        val itens = ConcurrentLinkedDeque<Item>()
    }
}
