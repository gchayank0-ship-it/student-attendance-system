
pipeline {
    agent any

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Check Node.js') {
            steps {
                sh 'node --version'
                sh 'npm --version'
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm install'
            }
        }

        stage('Syntax Checks') {
            steps {
                sh 'node --check server.js'
                sh 'node --check public/app.js'
            }
        }
    }

    post {
        success {
            echo 'Student Attendance CI completed successfully!'
        }
        failure {
            echo 'CI failed. Check the console output.'
        }
    }
}
