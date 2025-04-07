import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CollectData } from './collect-data';
import { WebApp } from './web-app';

export class GiltsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const {
      GILTS_GIT_REPO_URL,
      GILTS_GIT_REPO_CONNECTION_ARN
    } = process.env

    if (!GILTS_GIT_REPO_URL) {
      throw new Error('GILTS_GIT_REPO_URL environment variable is not set');
    }

    if (!GILTS_GIT_REPO_CONNECTION_ARN) {
      throw new Error('GILTS_CODESTAR_CONNECTION_ARN environment variable is not set');
    }

    const collectData = new CollectData(this, 'collect-data', {
      gitRepoUrl: GILTS_GIT_REPO_URL,
      gitRepoConnectionArn: GILTS_GIT_REPO_CONNECTION_ARN,
    })

    const webApp = new WebApp(this, 'web-app', {
      dataBucket: collectData.dataBucket,
    })

    new cdk.CfnOutput(this, 'export-webapp-bucket-name', {
      value: webApp.webAppBucket.bucketName,
      description: 'Bucket name for the web app',
      exportName: 'WebAppBucketName',
    }) 

    new cdk.CfnOutput(this, 'export-webapp-deploy-role-arn', {
      value: webApp.deployRole.roleArn,
      description: 'Role for deploying the web app',
      exportName: 'WebAppDeployRoleArn',
    }) 

    new cdk.CfnOutput(this, 'export-webapp-distribution-id', {
      value: webApp.dist.distributionId,
      description: 'CloudFront distribution ID',
      exportName: 'WebAppDistributionId',
    })
    
    new cdk.CfnOutput(this, 'export-webapp-domain-name', {
      value: webApp.dist.domainName,
      description: 'Domain name for web app',
      exportName: 'WebAppDomainName',
    }) 
  }
}
