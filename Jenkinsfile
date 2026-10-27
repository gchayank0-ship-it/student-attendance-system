
pipeline {
    agent any

    environment {
        DOCKER_HOST = 'tcp://host.docker.internal:2375'
        IMAGE_NAME = 'student-attendance-system'
    }

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

        stage('Build Docker Image') {
            steps {
                sh 'docker build -t student-attendance-system:${BUILD_NUMBER} .'
                sh 'docker images student-attendance-system'
            }
        }
    }

    post {
        success {
            echo 'CI and Docker image build completed successfully!'
        }
        failure {
            echo 'Pipeline failed. Check Console Output.'
        }
    }
}
