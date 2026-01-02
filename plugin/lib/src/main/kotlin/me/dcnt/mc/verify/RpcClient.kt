package me.dcnt.mc.verify

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

@Serializable
data class VerifyConnectionParams(
    val sharedSecret: String,
    val minecraftUUID: String
)

@Serializable(with = VerifyConnectionResultSerializer::class)
sealed interface VerifyConnectionResult {
    data object Success : VerifyConnectionResult
    data class Failure(val error: String) : VerifyConnectionResult
}

object VerifyConnectionResultSerializer : KSerializer<VerifyConnectionResult> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("VerifyConnectionResult") {
        element<Boolean>("success")
        element<String?>("error", isOptional = true)
    }

    override fun deserialize(decoder: Decoder): VerifyConnectionResult {
        val jsonDecoder = decoder as? JsonDecoder
            ?: throw IllegalStateException("This serializer only works with JSON")
        val jsonObject = jsonDecoder.decodeJsonElement().jsonObject
        val success = jsonObject["success"]?.jsonPrimitive?.content?.toBoolean() ?: false
        return if (success) {
            VerifyConnectionResult.Success
        } else {
            val error = jsonObject["error"]?.jsonPrimitive?.content ?: "Unknown error"
            VerifyConnectionResult.Failure(error)
        }
    }

    override fun serialize(encoder: Encoder, value: VerifyConnectionResult) {
        throw UnsupportedOperationException("Serialization not supported for VerifyConnectionResult")
    }
}

@Serializable
data class CreateVerificationFlowParams(
    val sharedSecret: String,
    val minecraftUUID: String
)

@Serializable
data class CreateVerificationFlowValue(
    val linkingCode: String,
    val expiresAt: String
)

@Serializable(with = CreateVerificationFlowResultSerializer::class)
sealed interface CreateVerificationFlowResult {
    data class Success(val value: CreateVerificationFlowValue) : CreateVerificationFlowResult
    data class Failure(val error: String) : CreateVerificationFlowResult
}

object CreateVerificationFlowResultSerializer : KSerializer<CreateVerificationFlowResult> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("CreateVerificationFlowResult") {
        element<Boolean>("success")
        element<CreateVerificationFlowValue?>("value", isOptional = true)
        element<String?>("error", isOptional = true)
    }

    override fun deserialize(decoder: Decoder): CreateVerificationFlowResult {
        val jsonDecoder = decoder as? JsonDecoder
            ?: throw IllegalStateException("This serializer only works with JSON")
        val jsonObject = jsonDecoder.decodeJsonElement().jsonObject
        val success = jsonObject["success"]?.jsonPrimitive?.content?.toBoolean() ?: false
        return if (success) {
            val valueJson = jsonObject["value"] ?: throw IllegalStateException("Missing 'value' in success response")
            val value = jsonDecoder.json.decodeFromJsonElement(CreateVerificationFlowValue.serializer(), valueJson)
            CreateVerificationFlowResult.Success(value)
        } else {
            val error = jsonObject["error"]?.jsonPrimitive?.content ?: "Unknown error"
            CreateVerificationFlowResult.Failure(error)
        }
    }

    override fun serialize(encoder: Encoder, value: CreateVerificationFlowResult) {
        throw UnsupportedOperationException("Serialization not supported for CreateVerificationFlowResult")
    }
}

class RpcClient(
    private val rpc: JsonRpcClient
) {

    fun verifyConnection(
        sharedSecret: String,
        uuid: String
    ): Result<VerifyConnectionResult> =
        rpc.call(
            method = "verifyConnection",
            params = VerifyConnectionParams(sharedSecret, uuid)
        )

    fun createVerificationFlow(
        sharedSecret: String,
        uuid: String
    ): Result<CreateVerificationFlowResult> =
        rpc.call(
            method = "createVerificationFlow",
            params = CreateVerificationFlowParams(sharedSecret, uuid)
        )
}
