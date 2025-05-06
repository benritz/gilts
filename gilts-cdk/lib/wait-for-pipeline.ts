import { Construct } from 'constructs'
import * as cdk from 'aws-cdk-lib'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as customRes from 'aws-cdk-lib/custom-resources'
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline'

export type WaitForPipelineProps = {
    pipeline: codepipeline.Pipeline
}

export class WaitForPipeline extends Construct {
    public constructor(scope: Construct, id: string, props: WaitForPipelineProps) {
        super(scope, id)

        const { pipeline } = props

        const waitForPipelineFn = new nodejs.NodejsFunction(
            this, 
            'waitForPipelineFn', 
            {
                runtime: lambda.Runtime.NODEJS_22_X, 
                architecture: lambda.Architecture.ARM_64,
                memorySize: 128,
                timeout: cdk.Duration.minutes(5),
                logGroup: new logs.LogGroup(this, 'wait-for-pipeline-log-group', {
                    removalPolicy: cdk.RemovalPolicy.DESTROY,
                    retention: logs.RetentionDays.FIVE_DAYS,
                }),
                bundling: {
                    minify: true,
                    sourceMap: true,
                    sourceMapMode: nodejs.SourceMapMode.INLINE,
                    sourcesContent: false,
                    target: 'es2022',
                },
            }
        )

        waitForPipelineFn.addToRolePolicy(new iam.PolicyStatement({ 
            effect: iam.Effect.ALLOW,
            actions: [
                'codepipeline:GetPipelineExecution',
                'codepipeline:ListPipelineExecutions',
                'codepipeline:ExecutePipeline',
                'codepipeline:GetPipelineExecution',
            ],
            resources: ["*"],
            conditions: {
                StringEquals: {
                    "aws:RequestedRegion": [cdk.Stack.of(this).region],
                },
            }
        }))

        const provider = new customRes.Provider(this, 'provider', {
            onEventHandler: waitForPipelineFn,
            logGroup: new logs.LogGroup(this, 'provider-log-group', {
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                retention: logs.RetentionDays.FIVE_DAYS,
            }),        
        })

        new cdk.CustomResource(this, 'customResource', {
            serviceToken: provider.serviceToken,
            properties: {
                pipelineName: pipeline.pipelineName,
            },
        })
    }
}
