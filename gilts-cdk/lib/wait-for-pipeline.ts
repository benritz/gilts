import { Construct } from 'constructs'
import * as cdk from 'aws-cdk-lib'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as customRes from 'aws-cdk-lib/custom-resources'
import { ContainerImage } from './container-image'
import { pipeline } from 'stream'

export type WaitForPipelineProps = {
    containerImage: ContainerImage
}

export class WaitForPipeline extends Construct {
    public constructor(scope: Construct, id: string, props: WaitForPipelineProps) {
        super(scope, id)

        const { containerImage } = props

        const uniqueId = cdk.Names.uniqueId(this).toLowerCase()

        const waitForPipelineFnName = `wait-for-pl-${uniqueId}`
        const waitForPipelineFn = new nodejs.NodejsFunction(
            this, 
            'waitForPipelineFn', 
            {
                functionName: waitForPipelineFnName,
                runtime: lambda.Runtime.NODEJS_LATEST, 
                architecture: lambda.Architecture.ARM_64,
                memorySize: 128,
                timeout: cdk.Duration.minutes(5),
                logGroup: new logs.LogGroup(this, 'wait-for-pipeline-log-group', {
                    logGroupName: `/aws/lambda/${waitForPipelineFnName}`,
                    removalPolicy: cdk.RemovalPolicy.DESTROY,
                    retention: logs.RetentionDays.FIVE_DAYS,
                }),
                bundling: {
                    minify: true,
                    sourceMap: true,
                    sourceMapMode: nodejs.SourceMapMode.INLINE,
                    sourcesContent: false,
                    target: 'es2022',
                }
            }
        )

        waitForPipelineFn.addToRolePolicy(new iam.PolicyStatement({ 
            effect: iam.Effect.ALLOW,
            actions: [
                'codepipeline:GetPipelineExecution',
                'codepipeline:ListPipelineExecutions',
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
                logGroupName: `/aws/lambda/provider-${uniqueId}`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                retention: logs.RetentionDays.FIVE_DAYS,
            }),        
        })

        const { pipeline } = containerImage

        new cdk.CustomResource(this, 'customResource', {
            serviceToken: provider.serviceToken,
            properties: {
                pipelineName: pipeline.pipelineName,
            },
        })
    }
}
