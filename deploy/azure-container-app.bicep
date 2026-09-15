@description('Azure region for the Container Apps environment.')
param location string

@description('Name of the existing Azure Container Registry.')
param registryName string

@description('Container image tag already built in the registry.')
param imageTag string

@description('Container Apps managed environment name.')
param environmentName string = 'sage-environment'

@description('Container App name.')
param appName string = 'sage-support'

@description('Azure OpenAI resource endpoint.')
param azureOpenAIEndpoint string

@description('Azure OpenAI model deployment name.')
param azureLlmDeployment string

@description('Whether Azure Speech transcription is enabled.')
param speechEnabled bool = false

@description('Azure AI Speech resource endpoint.')
param azureSpeechEndpoint string = ''

@description('Azure Speech transcription model name.')
param azureSpeechModel string = 'MAI-Transcribe-2'

@secure()
param contactHashKey string

param whatsappEnabled bool = false

@secure()
param whatsappVerifyToken string

@secure()
param metaAppSecret string

@secure()
param whatsappAccessToken string

param whatsappPhoneNumberId string

@secure()
param staffApiToken string

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    zoneRedundant: false
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 3000
        transport: 'auto'
      }
      registries: [
        {
          server: registry.properties.loginServer
          username: registry.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: registry.listCredentials().passwords[0].value
        }
        {
          name: 'contact-hash-key'
          value: contactHashKey
        }
        {
          name: 'whatsapp-verify-token'
          value: whatsappVerifyToken
        }
        {
          name: 'meta-app-secret'
          value: metaAppSecret
        }
        {
          name: 'whatsapp-access-token'
          value: whatsappAccessToken
        }
        {
          name: 'staff-api-token'
          value: staffApiToken
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'sage'
          image: '${registry.properties.loginServer}/sage-support:${imageTag}'
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'HOST'
              value: '0.0.0.0'
            }
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'DATA_DIR'
              value: '/tmp/sage-data'
            }
            {
              name: 'MANUAL_PATH'
              value: './knowledge-base/sal/data/sal-guide-chunks.jsonl'
            }
            {
              name: 'CONTACT_HASH_KEY'
              secretRef: 'contact-hash-key'
            }
            {
              name: 'LLM_PROVIDER'
              value: 'azure'
            }
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              value: azureOpenAIEndpoint
            }
            {
              name: 'AZURE_LLM_DEPLOYMENT'
              value: azureLlmDeployment
            }
            {
              name: 'SPEECH_PROVIDER'
              value: speechEnabled ? 'azure' : 'mock'
            }
            {
              name: 'AZURE_SPEECH_ENDPOINT'
              value: azureSpeechEndpoint
            }
            {
              name: 'AZURE_SPEECH_MODEL'
              value: azureSpeechModel
            }
            {
              name: 'ENABLE_TEST_ENDPOINTS'
              value: 'false'
            }
            {
              name: 'WHATSAPP_ENABLED'
              value: whatsappEnabled ? 'true' : 'false'
            }
            {
              name: 'WHATSAPP_VERIFY_TOKEN'
              secretRef: 'whatsapp-verify-token'
            }
            {
              name: 'META_APP_SECRET'
              secretRef: 'meta-app-secret'
            }
            {
              name: 'WHATSAPP_ACCESS_TOKEN'
              secretRef: 'whatsapp-access-token'
            }
            {
              name: 'WHATSAPP_PHONE_NUMBER_ID'
              value: whatsappPhoneNumberId
            }
            {
              name: 'WHATSAPP_GRAPH_API_VERSION'
              value: 'v26.0'
            }
            {
              name: 'WHATSAPP_MARK_MESSAGES_READ'
              value: 'true'
            }
            {
              name: 'STAFF_API_TOKEN'
              secretRef: 'staff-api-token'
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/ready'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 6
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output appName string = app.name
output appPrincipalId string = app.identity.principalId
output callbackUrl string = 'https://${app.properties.configuration.ingress.fqdn}/webhooks/whatsapp'
output healthUrl string = 'https://${app.properties.configuration.ingress.fqdn}/health'
output readyUrl string = 'https://${app.properties.configuration.ingress.fqdn}/ready'
