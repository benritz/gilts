import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as scheduler from '@aws-cdk/aws-scheduler-alpha'
import * as scheduler_targets from '@aws-cdk/aws-scheduler-targets-alpha'
import * as glue from '@aws-cdk/aws-glue-alpha';
import * as athena from 'aws-cdk-lib/aws-athena';

import { Construct } from 'constructs';
import { ContainerImages } from './container-image';

type CollectDataStackProps = cdk.StackProps & {
  gitRepoUrl: string
  gitRepoConnectionArn: string
}

export class CollectDataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CollectDataStackProps) {
    super(scope, id, props);

    const { 
      gitRepoUrl,
      gitRepoConnectionArn
    } = props

    const bucket = new s3.Bucket(this, 'data-bucket', {
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const artifactBucket = new s3.Bucket(this, 'artifact-bucket', {
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    const cis = new ContainerImages(this, 'container-images', {
      specs: [{
        name: 'collect-data',
        gitRepoUrl,
        gitRepoDockerfilePath: 'docker/collect-data',
        gitRepoConnectionArn,
        buildOnPush: false,
        waitForPipeline: true,
      }],
      artifactBucket,
    })

    const containerImage = cis.images.get('collect-data')
    if (!containerImage) {
      throw new Error('Container image not found');
    }

    const collectDataFn = new lambda.DockerImageFunction(this, 'collect-data-fn', {
      code: lambda.DockerImageCode.fromEcr(containerImage.ecrRepo, {tagOrDigest: 'latest'}),
      description: 'Collect gilts data',
      memorySize: 128,
      timeout: cdk.Duration.minutes(5),
      architecture: lambda.Architecture.ARM_64,
      logGroup: new logs.LogGroup(this, 'collect-data-log-group', {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        retention: logs.RetentionDays.FIVE_DAYS,
      }),
      environment: {
        GILTS_DATA_BUCKET_NAME: bucket.bucketName,
      },
    })

    bucket.grantReadWrite(collectDataFn)

    collectDataFn.node.addDependency(containerImage)

    const dlq = new sqs.Queue(this, 'collect-data-dlq', {
      retentionPeriod: cdk.Duration.days(14),
    })

    const queue = new sqs.Queue(this, 'collect-data-queue', {
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

    // based on DMO data release schedule, modify as needed
    new scheduler.Schedule(this, 'schedule', {
      description: 'Collect gilts data on weekdays at 14:30 UTC',
      schedule: scheduler.ScheduleExpression.cron({
          hour: '14',
          minute: '30',
          weekDay: '2-6',
      }),
      target: new scheduler_targets.SqsSendMessage(queue),
    })

   
    const database = new glue.Database(this, 'glue-database', {
      description: 'Gilts database',
    })

    const table = new glue.S3Table(this, 'glue-table', {
      database,
      columns: [
        { name: 'Type', type: glue.Schema.STRING },
        { name: 'Source', type: glue.Schema.STRING },
        { name: 'ISIN', type: glue.Schema.STRING },
        { name: 'Ticker', type: glue.Schema.STRING },
        { name: 'Desc', type: glue.Schema.STRING },
        { name: 'FacePrice', type: glue.Schema.DOUBLE },
        { name: 'Coupon', type: glue.Schema.DOUBLE },
        { name: 'SettlementDate', type: glue.Schema.TIMESTAMP },
        { name: 'PrevCouponDate', type: glue.Schema.TIMESTAMP },
        { name: 'NextCouponDate', type: glue.Schema.TIMESTAMP },
        { name: 'RemainingDays', type: glue.Schema.INTEGER },
        { name: 'AccruedDays', type: glue.Schema.INTEGER },
        { name: 'CouponPeriodDays', type: glue.Schema.INTEGER },
        { name: 'CouponPeriods', type: glue.Schema.INTEGER },
        { name: 'MaturityDate', type: glue.Schema.TIMESTAMP },
        { name: 'MaturityYears', type: glue.Schema.INTEGER },
        { name: 'MaturityDays', type: glue.Schema.INTEGER },
        { name: 'CleanPrice', type: glue.Schema.DOUBLE },
        { name: 'DirtyPrice', type: glue.Schema.DOUBLE },
        { name: 'YieldToMaturity', type: glue.Schema.DOUBLE }
      ],
      partitionKeys: [
        { name: 'day', type: glue.Schema.STRING }
      ],
      dataFormat: glue.DataFormat.PARQUET,
      bucket,
      s3Prefix: '',
      description: 'Gilts data',
      storedAsSubDirectories: true,
      enablePartitionFiltering: true,
      parameters: {
        'projection.day.format': 'yyyy/MM/dd', 
        'projection.day.interval': '1', 
        'projection.day.interval.unit': 'DAYS', 
        'projection.day.range': '2024/01/01,NOW', 
        'projection.day.type': 'date', 
        'projection.enabled': 'true',
        'storage.location.template': `s3://${bucket.bucketName}/\${day}`,
      }
    })

    // configure Athena
    const athenaOutputBucket = new s3.Bucket(this, 'athena-results-bucket', {
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30), // Auto-delete query results after 30 days
        },
      ],
    });
    
    const workgroup = new athena.CfnWorkGroup(this, 'gilts-athena-workgroup', {
      name: 'gilts-analytics',
      description: 'Workgroup for querying gilts data',
      state: 'ENABLED',
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${athenaOutputBucket.bucketName}/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_S3'
          }
        },
        publishCloudWatchMetricsEnabled: true,
        enforceWorkGroupConfiguration: true,
        requesterPaysEnabled: false
      },
      recursiveDeleteOption: true,
    });    
  }
}
