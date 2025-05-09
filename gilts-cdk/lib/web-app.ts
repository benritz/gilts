import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfront_origins from 'aws-cdk-lib/aws-cloudfront-origins';

import { Construct } from 'constructs';

type WebAppProps = {
  dataBucket: s3.Bucket
}

export class WebApp extends Construct {
  webAppBucket: s3.Bucket
  deployRole: iam.Role
  dist: cloudfront.Distribution

  constructor(scope: Construct, id: string, props: WebAppProps) {
    super(scope, id)

    const { 
      dataBucket
    } = props

    const webAppBucket = new s3.Bucket(this, 'WebAppBucket', {
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    this.webAppBucket = webAppBucket

    const accessIdentity = new cloudfront.OriginAccessIdentity(this, 'CloudfrontAccess')

    const webAppAccessPolicy = new iam.PolicyStatement();
    webAppAccessPolicy.addActions('s3:GetObject');
    webAppAccessPolicy.addPrincipals(accessIdentity.grantPrincipal);
    webAppAccessPolicy.addResources(webAppBucket.arnForObjects('*'));
    webAppBucket.addToResourcePolicy(webAppAccessPolicy);    

    const dataAccessPolicy = new iam.PolicyStatement()
    dataAccessPolicy.addActions('s3:GetObject')
    dataAccessPolicy.addPrincipals(accessIdentity.grantPrincipal)
    dataAccessPolicy.addResources(dataBucket.arnForObjects('*'))
    dataBucket.addToResourcePolicy(dataAccessPolicy)

    const webAppOrigin = cloudfront_origins.S3BucketOrigin.withOriginAccessControl(webAppBucket, { originId: 'webAppOrigin' })
    const dataOrigin = cloudfront_origins.S3BucketOrigin.withOriginAccessControl(dataBucket, { originId: 'dataOrigin' })

    const dist = new cloudfront.Distribution(this, 'distribution', {
      defaultBehavior: {
          origin: webAppOrigin,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        'data/*': {
          origin: dataOrigin,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
        }
      },
      // domainNames: [domainName],
      sslSupportMethod: cloudfront.SSLMethod.SNI,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // certificate,
      comment: 'Gilts Web App',
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      // logBucket,
      // errorResponses: [ {
      //         httpStatus: 403,
      //         responseHttpStatus: 404,
      //         responsePagePath: '/404.html',
      //         ttl: cdk.Duration.minutes(5)
      //     },
      //     {
      //         httpStatus: 404,
      //         responsePagePath: '/404.html',
      //         ttl: cdk.Duration.minutes(5)
      //     }
      // ]
    })    

    this.dist = dist

    const deployRole = new iam.Role(this, 'WebAppDeployRole', {
      assumedBy: new iam.AccountPrincipal(cdk.Aws.ACCOUNT_ID),
    })

    webAppBucket.grantReadWrite(deployRole)
    dist.grantCreateInvalidation(deployRole)
    dist.grant(deployRole, 'cloudfront:GetInvalidation')

    const stack = cdk.Stack.of(this)
    
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudformation:DescribeStacks'],
      resources: [
        stack.formatArn({
          service: 'cloudformation',
          resource: 'stack',
          resourceName: `${stack.stackName}/*`,
        })
      ],
      effect: iam.Effect.ALLOW,
    }))

    new iam.ManagedPolicy(this, 'assume-policy', {
      statements: [
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: [deployRole.roleArn],
          effect: iam.Effect.ALLOW,
        })
      ]
    })

    this.deployRole = deployRole
  }
}
