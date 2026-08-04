pipeline {
    agent any

    stages {
        stage('Checkout') {
            steps {
                echo 'ดึงโค้ดจาก GitHub สำเร็จ'
            }
        }
        stage('Install') {
            steps {
                echo 'ขั้นตอน install (เดี๋ยวค่อยเพิ่มของจริง)'
            }
        }
    }

    post {
        success {
            echo '✅ Pipeline สำเร็จ!'
        }
        failure {
            echo '❌ Pipeline ล้มเหลว!'
        }
    }
}