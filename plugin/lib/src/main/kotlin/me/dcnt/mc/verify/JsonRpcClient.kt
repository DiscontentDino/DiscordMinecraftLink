package me.dcnt.mc.verify

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID

@Serializable
data class JsonRpcRequest<T>(
    val jsonrpc: String = "2.0",
    val method: String,
    val params: T,
    val id: String
)

@Serializable
data class JsonRpcError(
    val code: Int,
    val message: String,
    val data: String? = null
)

@Serializable
data class JsonRpcResponse<T>(
    val jsonrpc: String,
    val result: T? = null,
    val error: JsonRpcError? = null,
    val id: String?
)

class JsonRpcClient(
    val baseUrl: String,
    @PublishedApi internal val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
) {

    /**
     * Core JSON-RPC 2.0 call returning kotlin.Result
     */
    inline fun <reified P, reified R> call(
        method: String,
        params: P
    ): Result<R> {

        val request = JsonRpcRequest(
            method = method,
            params = params,
            id = UUID.randomUUID().toString()
        )

        return runCatching {
            val body = json.encodeToString(serializer<JsonRpcRequest<P>>(), request)
            val responseBody = httpPost("$baseUrl/api/rpc", body)

            val response = json.decodeFromString<JsonRpcResponse<R>>(responseBody)

            when {
                response.error != null ->
                    throw IllegalStateException(
                        "RPC ${response.error.code}: ${response.error.message}"
                    )

                response.result == null ->
                    throw IllegalStateException("RPC returned null result")

                else -> response.result
            }
        }
    }

    @PublishedApi
    internal fun httpPost(url: String, body: String): String {
        val connection = URI(url).toURL().openConnection() as HttpURLConnection

        try {
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            connection.doOutput = true

            connection.outputStream.use { it.write(body.toByteArray()) }

            val input =
                if (connection.responseCode in 200..299) connection.inputStream
                else connection.errorStream

            return input.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }
}
