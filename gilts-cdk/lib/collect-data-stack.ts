import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as scheduler from '@aws-cdk/aws-scheduler-alpha'
import * as scheduler_targets from '@aws-cdk/aws-scheduler-targets-alpha'

import { Construct } from 'constructs';
import { ContainerImages } from './container-image';
import { WaitForPipeline } from './wait-for-pipeline';

type CollectDataStackProps = cdk.StackProps & {
  bucketName?: string
  gitRepoUrl: string
  gitRepoConnectionArn: string
}

export class CollectDataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CollectDataStackProps) {
    super(scope, id, props);

    const { 
      bucketName,
      gitRepoUrl,
      gitRepoConnectionArn
    } = props

    const uniqueId = cdk.Names.uniqueId(this).toLowerCase()

    const bucket = new s3.Bucket(this, 'data-bucket', {
      bucketName: bucketName ?? `gilts-data-${uniqueId}`,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const artifactBucket = new s3.Bucket(this, 'artifact-bucket', {
      bucketName: bucketName ?? `collect-data-artifact-${uniqueId}`,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    const cis = new ContainerImages(this, 'container-images', {
      projectName: `collect-data-build-${uniqueId}`,
      specs: [{
        name: `collect-data-${uniqueId}`,
        ecrRepoGroup: 'gilts',
        gitRepoUrl,
        gitRepoDockerfilePath: 'docker/collect-data',
        gitRepoConnectionArn,
      }],
      artifactBucket,
    })

    const containerImage = cis.images.get(`collect-data-${uniqueId}`)
    if (!containerImage) {
      throw new Error('Container image not found');
    }

    const collectDataFnName = `collect-data-${uniqueId}`
    const collectDataFn = new lambda.DockerImageFunction(this, 'collect-data-fn', {
      code: lambda.DockerImageCode.fromEcr(containerImage.ecrRepo, {tagOrDigest: 'latest'}),
      functionName: collectDataFnName,
      description: 'Collect gilts data',
      memorySize: 128,
      timeout: cdk.Duration.minutes(5),
      architecture: lambda.Architecture.ARM_64,
      logGroup: new logs.LogGroup(this, 'collect-data-log-group', {
        logGroupName: `/aws/lambda/${collectDataFnName}`,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        retention: logs.RetentionDays.FIVE_DAYS,
      }),
      environment: {
        GILTS_DATA_BUCKET_NAME: bucket.bucketName,
      },
    })

    bucket.grantReadWrite(collectDataFn)

    const waitForPipeline = new WaitForPipeline(this, 'waitForPipeline', { containerImage })
    collectDataFn.node.addDependency(waitForPipeline)

    const dlq = new sqs.Queue(this, 'collect-data-dlq', {
      queueName: `collect-data-dlq-${uniqueId}`,
      retentionPeriod: cdk.Duration.days(14),
    })

    const queue = new sqs.Queue(this, 'collect-data-queue', {
      queueName: `collect-data-queue-${uniqueId}`,
      retentionPeriod: cdk.Duration.days(1),
      visibilityTimeout: cdk.Duration.hours(1),
      deadLetterQueue: {
        maxReceiveCount: 12,
        queue: dlq,
      },
    })

    queue.grantConsumeMessages(collectDataFn)

    collectDataFn.addEventSourceMapping('collect-data-fn-mapping', {
      eventSourceArn: queue.queueArn,
      batchSize: 1,
      enabled: true,
    })

    new scheduler.Schedule(this, 'scheduleDaily', {
      scheduleName: `gilts-collect-data-daily-${uniqueId}`,
      description: 'Collect gilts data daily at 12:00 UTC',
      schedule: scheduler.ScheduleExpression.cron({
          hour: '12',
          minute: '0',
      }),
      target: new scheduler_targets.SqsSendMessage(queue),
    })
  }
}
