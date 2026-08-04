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
            sh '''
                curl -H "Content-Type: application/json" -X POST -d '{
                  "embeds": [{
                    "title": "services",
                    "description": "Jenkins Pipeline Build #'$BUILD_NUMBER' | SUCCESS",
                    "color": 3066993
                  }]
                }' $DISCORD_WEBHOOK_URL
            '''
        }
        failure {
            sh '''
                curl -H "Content-Type: application/json" -X POST -d '{
                  "embeds": [{
                    "title": "services",
                    "description": "Jenkins Pipeline Build #'$BUILD_NUMBER' | FAILURE",
                    "color": 15158332
                  }]
                }' $DISCORD_WEBHOOK_URL
            '''
        }
    }
}