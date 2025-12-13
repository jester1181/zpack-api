import { Worker } from 'bullmq'
import prisma from '../services/prisma.js';
import { runProvisionPlaybook } from '../ansible/runProvision.js'
import { redisOptions } from '../utils/redis.js'



export const provisionWorker = new Worker('zpack-provision', async (job) => {
  const { customerId, gameType, memory, cores, template } = job.data
  
  try {
    // Update job status to running
    await updateJobStatus(job.data.jobId, 'RUNNING', 'Starting container provisioning')
    await job.updateProgress(10)
    
    // Get customer port allocation
    const portAllocation = await getCustomerPorts(customerId)
    if (!portAllocation) {
      throw new Error('No port allocation found for customer')
    }
    
    await job.updateProgress(25)
    await updateJobStatus(job.data.jobId, 'RUNNING', 'Running Ansible playbook')
    
    // Get next available VMID
    const vmid = await getNextVMID()
    
    // Prepare data for your Ansible runner
    const ansibleData = {
      user_id: customerId,
      game: gameType,
      ports: portAllocation.ports.length,
      mode: 'survival', // or from job data
      vmid: vmid,
      base_port: portAllocation.basePort,
      allocated_ports: portAllocation.ports.join(','),
      bridge: gameType.includes('dev') ? 'vmbr2' : 'vmbr3',
      memory: memory || 4096,
      cores: cores || 2,
      template: template || `base-${gameType}-v1.0`
    }
    
    await job.updateProgress(50)
    
    // Run your Ansible playbook
    const ansibleOutput = await runProvisionPlaybook(ansibleData)
    
    await job.updateProgress(75)
    
    // Create server instance record (extract IP from Ansible output if needed)
    const serverInstance = await prisma.serverInstance.create({
      data: {
        customerId,
        vmid: vmid,
        hostname: `${gameType}-${customerId}`,
        ip: extractIPFromOutput(ansibleOutput) || null, // Parse from Ansible output
        node: 'zlh-prod1', // or extract from output
        status: 'RUNNING',
        game: gameType,
        template: template,
        memory: memory,
        cores: cores
      }
    })
    
    // Create server ports
    await Promise.all(
      portAllocation.ports.map((port, index) => 
        prisma.serverPort.create({
          data: {
            serverId: serverInstance.id,
            port: port,
            purpose: index === 0 ? 'game' : `secondary-${index}`
          }
        })
      )
    )
    
    await job.updateProgress(100)
    await updateJobStatus(job.data.jobId, 'COMPLETED', `Container ${vmid} provisioned successfully`)
    
    return {
      success: true,
      serverId: serverInstance.id,
      vmid: vmid,
      ip: extractIPFromOutput(ansibleOutput),
      ports: portAllocation.ports,
      customerId: customerId
    }
    
  } catch (error) {
    console.error('Provision job failed:', error)
    await updateJobStatus(job.data.jobId, 'FAILED', error.message)
    throw error
  }
}, {
  connection: redisOptions  // Use your standardized Redis config
})

// Helper functions
async function updateJobStatus(jobId, status, logs) {
  await prisma.provisioningJob.update({
    where: { id: jobId },
    data: { 
      status,
      logs,
      updatedAt: new Date(),
      ...(status === 'COMPLETED' && { completedAt: new Date() }),
      ...(status === 'RUNNING' && !await jobHasStartTime(jobId) && { startedAt: new Date() })
    }
  })
}

async function jobHasStartTime(jobId) {
  const job = await prisma.provisioningJob.findUnique({
    where: { id: jobId },
    select: { startedAt: true }
  })
  return job?.startedAt !== null
}

async function getCustomerPorts(customerId) {
  const allocation = await prisma.portAllocation.findFirst({
    where: { customerId }
  })
  
  if (!allocation) return null
  
  return {
    basePort: allocation.basePort,
    ports: Array.from({length: allocation.count}, (_, i) => allocation.basePort + i)
  }
}

async function getNextVMID() {
  const usedVMIDs = await prisma.serverInstance.findMany({
    select: { vmid: true },
    where: { vmid: { not: null } }
  })
  
  const used = new Set(usedVMIDs.map(s => s.vmid))
  
  // Game servers: 400-699, Dev servers: 300-399
  for (let vmid = 400; vmid < 700; vmid++) {
    if (!used.has(vmid)) {
      return vmid
    }
  }
  
  throw new Error('No available VMIDs in range 400-699')
}

function extractIPFromOutput(output) {
  // Adjust this regex based on your Ansible output format
  const ipMatch = output?.match(/(?:container_ip|assigned_ip)["\s:]*([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/)
  return ipMatch?.[1] || null
}