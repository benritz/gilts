import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CollectDataStack } from './collect-data-stack';

export class GiltsCdkStack extends cdk.Stack {
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

    new CollectDataStack(this, 'CollectDataStack', {
      gitRepoUrl: GILTS_GIT_REPO_URL,
      gitRepoConnectionArn: GILTS_GIT_REPO_CONNECTION_ARN,
    });
  }
}
