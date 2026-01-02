package me.dcnt.mc.verify

import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.player.AsyncPlayerPreLoginEvent
import org.bukkit.plugin.java.JavaPlugin

class Main : JavaPlugin(), Listener {

    private val mm = MiniMessage.miniMessage()

    private lateinit var rpcClient: RpcClient
    private lateinit var sharedSecret: String
    private lateinit var serverUrl: String

    override fun onEnable() {
        saveDefaultConfig()

        sharedSecret = config.getString("shared-secret") ?: ""
        serverUrl = config.getString("server-url") ?: ""

        if (sharedSecret.isEmpty() || serverUrl.isEmpty()) {
            logger.severe("shared-secret and server-url must be set in the config.yml")
            server.pluginManager.disablePlugin(this)
            return
        }

        logger.info("Initializing DiscordMinecraftLink with server URL: $serverUrl")

        val jsonRpc = JsonRpcClient(serverUrl)
        rpcClient = RpcClient(jsonRpc)

        server.pluginManager.registerEvents(this, this)
        logger.info("DiscordMinecraftLink plugin enabled.")
    }

    @EventHandler
    fun onAsyncPlayerPreLogin(event: AsyncPlayerPreLoginEvent) {
        val uuid = event.uniqueId.toString()

        rpcClient.verifyConnection(sharedSecret, uuid).fold(
            onSuccess = { result ->
                if (result is VerifyConnectionResult.Success) return

                rpcClient.createVerificationFlow(sharedSecret, uuid).fold(
                    onSuccess = { flowResult ->
                        val message = when (flowResult) {
                            is CreateVerificationFlowResult.Success -> mm.deserialize(
                                """
                                <gold>Discord Verification Required</gold>

                                <gray>Your verification code: </gray>
                                <yellow>${flowResult.value.linkingCode}</yellow>

                                <gray>Visit: </gray><yellow>$serverUrl</yellow>
                                <gray>to link your Discord</gray>
                                """.trimIndent()
                            )
                            is CreateVerificationFlowResult.Failure -> {
                                logger.warning("Verification flow returned failure for UUID $uuid")
                                mm.deserialize("<red>Failed to get verification code.</red>")
                            }
                        }

                        event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, message)
                    },
                    onFailure = {
                        logger.severe("Failed to create verification flow: ${it.message}")
                        val msg = mm.deserialize("<red>Could not create verification flow.</red>")
                        event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, msg)
                    }
                )
            },
            onFailure = {
                logger.severe("Failed to verify connection: ${it.message}")
                val msg = mm.deserialize("<red>Verification failed. Try again.</red>")
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, msg)
            }
        )
    }
}
