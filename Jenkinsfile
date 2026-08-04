pipeline {
    agent any

    environment {
        DISCORD_WEBHOOK_URL = credentials('discord-webhook')
    }

    stages {
        stage('Install') {
            steps {
                sh 'npm install'
            }
        }
    }

    post {
        success {
            sh 'curl -H "Content-Type: application/json" -d \'{"content":"✅ UNO build สำเร็จ! (#\'$BUILD_NUMBER\')"}\' $DISCORD_WEBHOOK_URL'
        }
        failure {
            sh 'curl -H "Content-Type: application/json" -d \'{"content":"❌ UNO build ล้มเหลว! (#\'$BUILD_NUMBER\')"}\' $DISCORD_WEBHOOK_URL'
        }
    }
}