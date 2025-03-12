import type { CdkCustomResourceEvent, CdkCustomResourceResponse, Context} from "aws-lambda"
import { 
    CodePipelineClient, 
    GetPipelineExecutionCommand, 
    ListPipelineExecutionsCommand, 
    PipelineExecutionStatus,
    StartPipelineExecutionCommand,
} from "@aws-sdk/client-codepipeline"

const { AWS_REGION } = process.env

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const executePipeline = async (
    client: CodePipelineClient, 
    pipelineName: string
): Promise<string|undefined> => {
    const {pipelineExecutionId} = await client.send(new StartPipelineExecutionCommand({name: pipelineName}))

    return pipelineExecutionId
}

const checkPipelineStatus = async (
    client: CodePipelineClient, 
    pipelineName: string,
    pipelineExecutionId?: string,
): Promise<PipelineExecutionStatus|undefined> => {
    if (pipelineExecutionId) {
        const ret = await client.send(new GetPipelineExecutionCommand({pipelineName, pipelineExecutionId}))
        const status = ret.pipelineExecution?.status
        
        switch (status) {
            case PipelineExecutionStatus.Succeeded:
                return status
            case PipelineExecutionStatus.Failed:
            case PipelineExecutionStatus.Cancelled:
                return PipelineExecutionStatus.Failed
            default:
                return PipelineExecutionStatus.InProgress
        }
    }

    const ret = await client.send(new ListPipelineExecutionsCommand({pipelineName}))

    const summaries = ret.pipelineExecutionSummaries

    if (!summaries || summaries.length === 0) {
        return undefined
    }

    const succeeded = summaries.filter((e) => e.status === PipelineExecutionStatus.Succeeded)
    if (succeeded.length > 0) {
        return PipelineExecutionStatus.Succeeded
    }

    const inprogress = summaries.filter((e) => 
        !(e.status === PipelineExecutionStatus.Failed || e.status === PipelineExecutionStatus.Cancelled))
    if (inprogress.length > 0) {
        return PipelineExecutionStatus.InProgress
    }

    return PipelineExecutionStatus.Failed
}

type Data = {
    PipelineStatus?: PipelineExecutionStatus
    Error?: unknown
}

export const handler = async (
    event: CdkCustomResourceEvent, 
    context: Context
): Promise<CdkCustomResourceResponse> => {
    const  { 
        StackId,
        RequestId,
        RequestType,
        LogicalResourceId,
        ResourceProperties: { pipelineName }
    } = event

    let Status = 'SUCCESS',
        Data: Data | undefined

    try {
        switch (RequestType) {
            case 'Create':
            case 'Update':
                // check that the pipeline has run successfully at least once 
                // otherwise wait for/start the pipeline execution
                const client = new CodePipelineClient({ region: AWS_REGION });

                try {
                    const maxChecks = 10    // 5 minutes
                    let checks = 0
                    let pipelineExecutionId: string | undefined

                    while (checks < maxChecks && Data === undefined) {                        
                        const status = await checkPipelineStatus(client, pipelineName, pipelineExecutionId)

                        console.log(`Pipeline ${pipelineName}: ${status || 'Unknown'} after ${checks} check/s`)

                        switch (status) {
                            case PipelineExecutionStatus.InProgress:
                                await sleep(30_000)
                                break;
                            case PipelineExecutionStatus.Succeeded:
                                Data = { PipelineStatus: status }
                                break;
                            case PipelineExecutionStatus.Failed:
                                Data = { PipelineStatus: status }
                                break;
                            default:
                                // unknown - might not have been executed
                                // execute after 2 checks/1 minute
                                if (checks >= 2) {
                                    pipelineExecutionId = await executePipeline(client, pipelineName)
                                }
                                await sleep(30_000)
                                break;
                            }

                        ++checks                        
                    }
                } finally {
                    client.destroy();
                }
                
                break
                case 'Delete':
                    // nothing to do
                    break
                }
        
    } catch (Error) {
        Status = 'FAILED'
        Data = { Error }

        console.error(`Failed to check pipeline status: ${pipelineName}`, Error)
    }

    return {
        StackId,
        RequestId,
        LogicalResourceId, 
        PhysicalResourceId: `wait-for-pipeline-${pipelineName}`,
        Status,
        Data
    }
}