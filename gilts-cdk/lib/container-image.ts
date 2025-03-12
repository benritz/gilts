import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { WaitForPipeline } from './wait-for-pipeline';

export type ContainerImageSpec = {
    name: string
    gitRepoUrl: string
    gitRepoBranch?: string
    gitRepoDockerfilePath: string
    gitRepoConnectionArn: string
    buildOnPush: boolean
    waitForPipeline: boolean
}

export type ContainerImagesProps = {
    specs: ContainerImageSpec[],
    artifactBucket?: s3.IBucket
}

export class ContainerImages extends Construct {
    images: Map<string, ContainerImage>

    constructor(scope: Construct, id: string, props: ContainerImagesProps) {
        super(scope, id)

        const {
            specs,
            artifactBucket
        } = props

        const buildSpec = codebuild.BuildSpec.fromObject({
            version: '0.2',
            phases: {
                pre_build: {
                    commands: [
                        `aws ecr get-login-password | docker login --username AWS --password-stdin https://$ECR_REPO_URL`,
                    ]
                },
                build: {
                    commands: [
                        `docker build --no-cache -t $ECR_REPO_URL:$IMAGE_TAG -f $GIT_REPO_DOCKERFILE_PATH/Dockerfile .`
                    ],
                },
                post_build: {
                    commands: [
                        `docker push $ECR_REPO_URL:$IMAGE_TAG`
                    ]
                }
            },
            artifacts: {
                files: []
            }
          })
      
        const buildProject = new codebuild.PipelineProject(this, 'build-project', {
            environment: {
              computeType: codebuild.ComputeType.SMALL,
              buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0
            },
            buildSpec,
            logging: {
                cloudWatch: {
                    logGroup: new logs.LogGroup(this, 'build-project-logs', {
                        removalPolicy: cdk.RemovalPolicy.DESTROY,
                        retention: logs.RetentionDays.FIVE_DAYS
                    }),
                },
            }
        })

        const builds = new Map<string, codebuild.PipelineProject>([
            ['latest', buildProject]
        ])

        const images = specs.reduce(
            (acc, spec, n) => 
                acc.set(spec.name, new ContainerImage(this, `container-image-${n}`, { 
                    ...spec, 
                    builds,
                    artifactBucket,
                }))
            , new Map<string, ContainerImage>()
        )

        this.images = images
    }
}

export type ContainerImageProps = {
    name: string
    gitRepoUrl: string
    gitRepoBranch?: string
    gitRepoConnectionArn: string
    gitRepoDockerfilePath: string
    builds: Map<string, codebuild.PipelineProject>
    artifactBucket?: s3.IBucket,
    buildOnPush: boolean,
    waitForPipeline: boolean
}

const parseGitHubUrl = (url: string): { owner: string, repo: string } => {
    // https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const match = url.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(\.git)?$/)
    if (!match) {
        throw new Error(`Invalid GitHub URL: ${url}`)
    }
    return {
        owner: match[1],
        repo: match[2]
    }
}

export class ContainerImage extends Construct {
    ecrRepo: ecr.Repository
    pipeline: codepipeline.Pipeline

    constructor(scope: Construct, id: string, props: ContainerImageProps) {
        super(scope, id)

        const {
            name,
            gitRepoUrl,
            gitRepoBranch,
            gitRepoConnectionArn,
            gitRepoDockerfilePath,
            builds,
            artifactBucket,
            buildOnPush,
            waitForPipeline,
        } = props

        const ecrRepo = new ecr.Repository(this, 'ecrRepo', {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
            imageScanOnPush: true,
            lifecycleRules: [
                {
                    tagStatus: ecr.TagStatus.UNTAGGED,
                    maxImageAge: cdk.Duration.days(30),
                    description: 'Remove untagged images after 30 days'
                }
            ],
            // TODO ECR.3 need to support immutable tags but latest is not an exception yet
            // imageTagMutability: ecr.TagMutability.IMMUTABLE
            imageTagMutability: ecr.TagMutability.MUTABLE
        })

        this.ecrRepo = ecrRepo

        const pipeline = new codepipeline.Pipeline(this, 'pipeline', {
            pipelineType: codepipeline.PipelineType.V2,
            artifactBucket,
        })

        this.pipeline = pipeline

        const { owner, repo } = parseGitHubUrl(gitRepoUrl)

        const sourceArtifact = new codepipeline.Artifact()

        const source = new codepipeline_actions.CodeStarConnectionsSourceAction({
            actionName: 'Source',
            connectionArn: gitRepoConnectionArn,
            output: sourceArtifact,
            owner,
            repo,
            branch: gitRepoBranch ?? 'main',
            triggerOnPush: buildOnPush,
        })

        pipeline.addStage({
            stageName: 'Source',
            actions: [source]
        })

        const buildEntries = Array.from(builds.entries())

        buildEntries.forEach(([, buildProject]) => ecrRepo.grantPullPush(buildProject))

        pipeline.addStage({
           stageName: 'Build',
            actions: buildEntries.map(([imageTag, buildProject]) =>
                new codepipeline_actions.CodeBuildAction({
                    actionName: `Build_${imageTag.replace('-', '_')}`,
                    project: buildProject,
                    input: sourceArtifact,
                    outputs: [],
                    environmentVariables: {
                        'ECR_REPO_URL': {
                            value: ecrRepo.repositoryUri, 
                            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT 
                        },
                        'IMAGE_TAG': {
                            value: imageTag,
                            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT 
                        },
                        'GIT_REPO_DOCKERFILE_PATH': {
                            value: gitRepoDockerfilePath,
                            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                        },
                    }
                })
            )
        })

        if (waitForPipeline) {
            new WaitForPipeline(this, 'waitForPipeline', { pipeline })
        }
    }
}
